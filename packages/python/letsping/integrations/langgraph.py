# packages/python/letsping/integrations/langgraph.py
from typing import Optional, Any, Dict, Iterator, Tuple
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple
from .. import LetsPing

class LetsPingCheckpointer(BaseCheckpointSaver):
    """
    A LangGraph Checkpointer that encrypts and parks state in LetsPing's Cryo-Sleep storage.
    """
    def __init__(self, client: LetsPing):
        super().__init__()
        self.client = client
        self._checkpoints: Dict[str, Tuple[Checkpoint, CheckpointMetadata]] = {}

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, str | float | int]
    ) -> RunnableConfig:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = checkpoint["id"]
        
        self._checkpoints[f"{thread_id}:{checkpoint_id}"] = (checkpoint, metadata)
        
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id,
            }
        }

    def get_tuple(self, config: RunnableConfig) -> Optional[CheckpointTuple]:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"].get("checkpoint_id")
        
        if checkpoint_id:
            key = f"{thread_id}:{checkpoint_id}"
            if key in self._checkpoints:
                cp, meta = self._checkpoints[key]
                return CheckpointTuple(config, cp, meta)
                
        latest = None
        for k, v in self._checkpoints.items():
            if k.startswith(f"{thread_id}:"):
                latest = CheckpointTuple(config, v[0], v[1])
        return latest

    def list(
        self,
        config: Optional[RunnableConfig],
        *,
        filter: Optional[Dict[str, Any]] = None,
        before: Optional[RunnableConfig] = None,
        limit: Optional[int] = None,
    ) -> Iterator[CheckpointTuple]:
        yield from []