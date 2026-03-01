import { DynamicStructuredTool } from "@langchain/core/tools";
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

export function createLetsPingTool<T extends z.ZodType>(options: AdapterOptions<T>) {
    if (!options.apiKey) {
        throw new Error("LetsPing Adapter Error: 'apiKey' is required.");
    }

    const lp = new LetsPing(options.apiKey);

    const func = async function* (args: any) {
        try {
                const request = await lp.defer({
                    service: options.service || "langchain-agent",
                    action: options.name,
                    priority: options.priority || "medium",
                    payload: args,
                    schema: options.schema,
                    timeoutMs: options.timeout
                });

                const triageUrl = `https://letsping.co/requests/${request.id}`;

                yield {
                    status: "intercepted_by_firewall",
                    reason: "Tool execution paused for human approval via LetsPing.",
                    triage_url: triageUrl,
                    request_id: request.id
                };

                const decision = await lp.waitForDecision(request.id, {
                    originalPayload: args,
                    timeoutMs: options.timeout
                });

                if (decision.status === "REJECTED") {
                    return JSON.stringify({
                        status: "REJECTED",
                        message: "The human operator denied this request. Do not proceed with the action.",
                        metadata: decision.metadata
                    });
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

                    return JSON.stringify(options.handler ? { letsping_context, execution_output } : letsping_context);
                }

                const letsping_context = {
                    status: "APPROVED",
                    executed_input,
                    metadata: decision.metadata
                };

                return JSON.stringify(options.handler ? { letsping_context, execution_output } : letsping_context);

        } catch (error: any) {
            return JSON.stringify({
                status: "ERROR",
                error: error.message || "Unknown error during LetsPing approval process",
                suggestion: "Inform the user that the request for approval failed or timed out."
            });
        }
    };

    return new DynamicStructuredTool({
        name: options.name,
        description: `${options.description} [SYSTEM NOTE: This tool pauses execution until a human approves the request via LetsPing. Do not expect an immediate result.]`,
        schema: options.schema as any,
        func: func as any
    });
}