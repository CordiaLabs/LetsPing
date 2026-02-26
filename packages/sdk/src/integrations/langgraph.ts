import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";
import { LetsPing } from "../index";

type StoredCheckpoint = {
    checkpoint: Checkpoint;
    metadata: CheckpointMetadata;
};

export class LetsPingCheckpointer extends BaseCheckpointSaver {
    private checkpoints: Record<string, StoredCheckpoint> = {};

    constructor(public client: LetsPing) {
        super();
    }

    private getTransport(): (<T = any>(method: string, path: string, body?: any) => Promise<T>) | null {
        const clientAny = this.client as any;
        if (typeof clientAny.request === "function") {
            return clientAny.request.bind(this.client);
        }
        return null;
    }

    private async saveRemote(
        threadId: string,
        checkpointId: string,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<void> {
        const transport = this.getTransport();
        if (!transport) {
            console.warn("[LetsPingCheckpointer] Missing underlying transport; falling back to in-memory only.");
            return;
        }
        try {
            await transport("POST", "/langgraph/checkpoints", {
                thread_id: threadId,
                checkpoint_id: checkpointId,
                checkpoint,
                metadata,
            });
        } catch (e) {
            console.warn("[LetsPingCheckpointer] Failed to persist checkpoint remotely; falling back to in-memory only.", e);
        }
    }

    private async loadRemote(
        threadId: string,
        checkpointId?: string
    ): Promise<StoredCheckpoint | null> {
        const transport = this.getTransport();
        if (!transport) {
            console.warn("[LetsPingCheckpointer] Missing underlying transport; using in-memory checkpoints only.");
            return null;
        }
        const search = checkpointId
            ? `?thread_id=${encodeURIComponent(threadId)}&checkpoint_id=${encodeURIComponent(checkpointId)}`
            : `?thread_id=${encodeURIComponent(threadId)}&latest=1`;
        try {
            const res = await transport<any>("GET", `/langgraph/checkpoints${search}`);
            if (res && res.checkpoint && res.metadata) {
                return { checkpoint: res.checkpoint as Checkpoint, metadata: res.metadata as CheckpointMetadata };
            }
        } catch (e) {
            // If not found or backend unavailable, fall back to local cache only.
            console.warn("[LetsPingCheckpointer] Failed to load remote checkpoint", e);
        }
        return null;
    }

    private async deleteRemote(threadId: string): Promise<void> {
        const transport = this.getTransport();
        if (!transport) return;
        const search = `?thread_id=${encodeURIComponent(threadId)}`;
        try {
            await transport("DELETE", `/langgraph/checkpoints${search}`);
        } catch (e) {
            console.warn("[LetsPingCheckpointer] Failed to delete remote checkpoints", e);
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        newVersions?: Record<string, string | number>
    ): Promise<RunnableConfig> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = checkpoint.id;

        if (!threadId || !checkpointId) {
            return config;
        }

        this.checkpoints[`${threadId}:${checkpointId}`] = { checkpoint, metadata };
        await this.saveRemote(threadId, checkpointId, checkpoint, metadata);

        return {
            configurable: {
                thread_id: threadId,
                checkpoint_id: checkpointId,
            },
        };
    }

    // METHODS REQUIRED BY LANGGRAPH V0.1+
    async putWrites(config: RunnableConfig, writes: any, taskId: string): Promise<void> {
        // No-op for V1: LetsPing focuses on primary state parking, not granular sub-task writes.
    }

    async deleteThread(threadId: string): Promise<void> {
        for (const key of Object.keys(this.checkpoints)) {
            if (key.startsWith(`${threadId}:`)) {
                delete this.checkpoints[key];
            }
        }
        await this.deleteRemote(threadId);
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = config.configurable?.checkpoint_id;
        if (!threadId) return undefined;

        // Prefer remote truth, fall back to local cache.
        const remote = await this.loadRemote(threadId, checkpointId);
        if (remote) {
            return { config, checkpoint: remote.checkpoint, metadata: remote.metadata };
        }

        if (checkpointId) {
            const match = this.checkpoints[`${threadId}:${checkpointId}`];
            if (match) {
                return { config, checkpoint: match.checkpoint, metadata: match.metadata };
            }
        }

        let latest: CheckpointTuple | undefined;
        for (const [key, val] of Object.entries(this.checkpoints)) {
            if (key.startsWith(`${threadId}:`)) {
                latest = { config, checkpoint: val.checkpoint, metadata: val.metadata };
            }
        }
        return latest;
    }

    async *list(config: RunnableConfig, options?: any): AsyncGenerator<CheckpointTuple> {
        const threadId = config.configurable?.thread_id;
        if (!threadId) return;

        const remoteLatest = await this.loadRemote(threadId);
        if (remoteLatest) {
            yield { config, checkpoint: remoteLatest.checkpoint, metadata: remoteLatest.metadata };
        }

        for (const [key, val] of Object.entries(this.checkpoints)) {
            if (key.startsWith(`${threadId}:`)) {
                yield { config, checkpoint: val.checkpoint, metadata: val.metadata };
            }
        }
    }
}