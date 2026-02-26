# packages/python/letsping/integrations/langgraph.py
from typing import Optional, Any, Dict, Iterator, Tuple

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple
from .. import LetsPing


class LetsPingCheckpointer(BaseCheckpointSaver):
    """
    A LangGraph Checkpointer that persists checkpoints remotely via the LetsPing control plane.

    Checkpoints are encrypted and stored alongside your existing Cryo-Sleep state in Supabase
    Storage, scoped per project + thread.
    """

    def __init__(self, client: LetsPing):
        super().__init__()
        self.client = client
        self._checkpoints: Dict[str, Tuple[Checkpoint, CheckpointMetadata]] = {}

    def _key(self, thread_id: str, checkpoint_id: str) -> str:
        return f"{thread_id}:{checkpoint_id}"

    def _save_remote(
        self,
        thread_id: str,
        checkpoint_id: str,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
    ) -> None:
        body = {
            "thread_id": thread_id,
            "checkpoint_id": checkpoint_id,
            "checkpoint": checkpoint,
            "metadata": metadata,
        }
        try:
            resp = self.client._client.post("langgraph/checkpoints", json=body)
            self.client._handle_response(resp)
        except Exception as e:
            # Remote persistence is best-effort; LangGraph will still function with in-memory checkpoints only.
            from .. import logger  # reuse SDK logger
            logger.warning(f"LetsPingCheckpointer: failed to persist remote checkpoint, falling back to memory-only: {e}")

    def _load_remote(
        self,
        thread_id: str,
        checkpoint_id: Optional[str] = None,
    ) -> Optional[Tuple[Checkpoint, CheckpointMetadata]]:
        params: Dict[str, Any] = {"thread_id": thread_id}
        if checkpoint_id:
            params["checkpoint_id"] = checkpoint_id
        else:
            params["latest"] = "1"

        try:
            resp = self.client._client.get("langgraph/checkpoints", params=params)
            if resp.status_code == 404:
                return None
            data = self.client._handle_response(resp)
            cp = data.get("checkpoint")
            meta = data.get("metadata")
            if cp is None or meta is None:
                return None
            return cp, meta
        except Exception as e:
            from .. import logger
            logger.warning(f"LetsPingCheckpointer: failed to load remote checkpoint, using memory-only: {e}")
            return None

    def _delete_remote(self, thread_id: str) -> None:
        resp = self.client._client.delete("langgraph/checkpoints", params={"thread_id": thread_id})
        # Ignore specific errors; this is best-effort cleanup.
        if resp.status_code not in (200, 204, 404):
            self.client._handle_response(resp)

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, str | float | int],
    ) -> RunnableConfig:
        thread_id = config["configurable"].get("thread_id")
        checkpoint_id = checkpoint.get("id")

        if thread_id is None or checkpoint_id is None:
            return config

        self._checkpoints[self._key(thread_id, checkpoint_id)] = (checkpoint, metadata)
        self._save_remote(thread_id, checkpoint_id, checkpoint, metadata)

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id,
            }
        }

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        thread_id = config["configurable"].get("thread_id")
        checkpoint_id = config["configurable"].get("checkpoint_id")

        if thread_id is None:
            return None

        # Prefer the remote source of truth, fall back to local cache.
        remote = self._load_remote(thread_id, checkpoint_id)
        if remote is not None:
            cp, meta = remote
            return CheckpointTuple(config, cp, meta)

        if checkpoint_id:
            key = self._key(thread_id, checkpoint_id)
            if key in self._checkpoints:
                cp, meta = self._checkpoints[key]
                return CheckpointTuple(config, cp, meta)

        latest: Optional[CheckpointTuple] = None
        prefix = f"{thread_id}:"
        for key, (cp, meta) in self._checkpoints.items():
            if key.startswith(prefix):
                latest = CheckpointTuple(config, cp, meta)
        return latest

    def list(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> Iterator[CheckpointTuple]:
        if not config:
            return iter(())

        thread_id = config["configurable"].get("thread_id")
        if thread_id is None:
            return iter(())

        results: list[CheckpointTuple] = []

        # Best-effort: include the latest remote checkpoint first.
        remote = self._load_remote(thread_id)
        if remote is not None:
            cp, meta = remote
            results.append(CheckpointTuple(config, cp, meta))

        prefix = f"{thread_id}:"
        for key, (cp, meta) in self._checkpoints.items():
            if key.startswith(prefix):
                results.append(CheckpointTuple(config, cp, meta))

        if limit is not None:
            results = results[:limit]
        return iter(results)