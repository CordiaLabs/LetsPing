import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";
import { LetsPing } from "../index";

export class LetsPingCheckpointer extends BaseCheckpointSaver {
    private checkpoints: Record<string, [Checkpoint, CheckpointMetadata]> = {};

    constructor(public client: LetsPing) {
        super();
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        newVersions?: Record<string, string | number>
    ): Promise<RunnableConfig> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = checkpoint.id;

        this.checkpoints[`${threadId}:${checkpointId}`] = [checkpoint, metadata];

        return {
            configurable: {
                thread_id: threadId,
                checkpoint_id: checkpointId,
            }
        };
    }

    // --- NEW METHODS REQUIRED BY LANGGRAPH V0.1+ ---
    async putWrites(config: RunnableConfig, writes: any, taskId: string): Promise<void> {
        // No-op for V1: LetsPing focuses on primary state parking, not granular sub-task writes.
    }

    async deleteThread(threadId: string): Promise<void> {
        for (const key of Object.keys(this.checkpoints)) {
            if (key.startsWith(`${threadId}:`)) {
                delete this.checkpoints[key];
            }
        }
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id;
        const checkpointId = config.configurable?.checkpoint_id;

        if (checkpointId) {
            const match = this.checkpoints[`${threadId}:${checkpointId}`];
            if (match) return { config, checkpoint: match[0], metadata: match[1] };
        }

        let latest: CheckpointTuple | undefined;
        for (const [key, val] of Object.entries(this.checkpoints)) {
            if (key.startsWith(`${threadId}:`)) {
                latest = { config, checkpoint: val[0], metadata: val[1] };
            }
        }
        return latest;
    }

    async *list(config: RunnableConfig, options?: any): AsyncGenerator<CheckpointTuple> {
        yield* [];
    }
}