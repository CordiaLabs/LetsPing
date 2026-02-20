import { DynamicStructuredTool } from "@langchain/core/tools";
import { LetsPing } from "@letsping/sdk";
import { z } from "zod";

interface AdapterOptions<T extends z.ZodType> {
    name: string;
    description: string;
    schema: T;
    apiKey: string;
    service?: string;
    priority?: "low" | "medium" | "high" | "critical";
    timeout?: number;
}

/**
 * Creates a LangChain Tool that pauses execution for human approval.
 * Compatible with LangGraph and standard Agents.
 */
export function createLetsPingTool<T extends z.ZodType>(options: AdapterOptions<T>) {
    if (!options.apiKey) {
        throw new Error("LetsPing Adapter Error: 'apiKey' is required.");
    }

    const lp = new LetsPing(options.apiKey);

    return new DynamicStructuredTool({
        name: options.name,
        description: `${options.description} [SYSTEM NOTE: This tool pauses execution until a human approves the request via LetsPing. Do not expect an immediate result.]`,
        schema: options.schema as any,
        func: async (args: any) => {
            try {
                const decision = await lp.ask({
                    service: options.service || "langchain-agent",
                    action: options.name,
                    priority: options.priority || "medium",
                    payload: args,
                    schema: options.schema,
                    timeoutMs: options.timeout
                });

                if (decision.status === "REJECTED") {
                    return JSON.stringify({
                        status: "REJECTED",
                        message: "The human operator denied this request. Do not proceed with the action.",
                        metadata: decision.metadata
                    });
                }

                return JSON.stringify({
                    status: "APPROVED",
                    approved_input: decision.patched_payload || decision.payload,
                    metadata: decision.metadata
                });

            } catch (error: any) {
                return JSON.stringify({
                    status: "ERROR",
                    error: error.message || "Unknown error during LetsPing approval process",
                    suggestion: "Inform the user that the request for approval failed or timed out."
                });
            }
        }
    });
}