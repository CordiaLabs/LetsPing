import { tool as createVercelTool } from "ai";
import { LetsPing, computeDiff } from "@letsping/sdk";
import { z } from "zod";

interface AdapterOptions<T extends z.ZodType> {
    name: string;
    description: string;
    schema: T;
    apiKey: string;
    service?: string;
    priority?: "low" | "medium" | "high" | "critical";
    timeout?: number;
    handler?: (args: z.infer<T>) => Promise<any> | any;
}

export function letsPing<T extends z.ZodType>(options: AdapterOptions<T>) {
    if (!options.apiKey) {
        throw new Error("LetsPing Adapter Error: 'apiKey' is required.");
    }

    const lp = new LetsPing(options.apiKey);

    return createVercelTool({
        description: `${options.description} [SYSTEM NOTE: This tool pauses execution to wait for human approval. Do not expect an immediate result.]`,
        parameters: options.schema,
        execute: async (args) => {
            try {
                const decision = await lp.ask({
                    service: options.service || "vercel-ai-sdk",
                    action: options.name,
                    priority: options.priority || "medium",
                    payload: args,
                    schema: options.schema,
                    timeoutMs: options.timeout,
                    environment: "vercel-ai"
                });

                if (decision.status === "REJECTED") {
                    return {
                        status: "REJECTED",
                        message: "The human operator explicitly denied this action. Do not proceed.",
                        metadata: decision.metadata,
                        rejection_reason: (decision as any).rejection_reason || "No reason provided"
                    };
                }

                const executed_input = decision.patched_payload || decision.payload;
                let execution_output;
                if (options.handler) {
                    execution_output = await options.handler(executed_input);
                }

                if (decision.patched_payload) {
                    const diff = computeDiff(decision.payload, decision.patched_payload);
                    const diff_summary = diff ? { changes: diff } : { changes: "Unknown structure changes" };

                    const letsping_context = {
                        status: "APPROVED_WITH_MODIFICATIONS",
                        message: "The human reviewer authorized this action but modified your original payload. Please review the diff_summary to learn from this correction.",
                        diff_summary,
                        original_input: decision.payload,
                        executed_input,
                        metadata: decision.metadata
                    };

                    return options.handler ? { letsping_context, execution_output } : letsping_context;
                }

                const letsping_context = {
                    status: "APPROVED",
                    original_input: args,
                    executed_input,
                    metadata: decision.metadata
                };

                return options.handler ? { letsping_context, execution_output } : letsping_context;

            } catch (error: any) {
                return {
                    status: "ERROR",
                    error: error.message || "Control plane unreachable or request timed out.",
                    suggestion: "Inform the user that the request for approval failed."
                };
            }
        },
    });
}