/**
 * @letsping/adapters/cloudflare — LetsPing adapter for Cloudflare Agents (Durable Objects).
 *
 * Designed for Agents SDK v0.7.0+:
 * - keepAliveWhile(): Keeps the Durable Object alive during HITL/escrow waits (no eviction mid-flight).
 * - diagnostics_channel: Pipes firewall and settlement events into Tail Workers.
 * - MCP-ready: Map MCP tool calls to LetsPing requests for firewalling.
 *
 * @see https://developers.cloudflare.com/changelog/post/2026-03-02-agents-sdk-v070/
 * @see https://developers.cloudflare.com/agents/api-reference/schedule-tasks/#keeping-the-agent-alive
 */

import { LetsPing, type RequestOptions, type Decision } from "@letsping/sdk";
import { z } from "zod";
import {
    emitIntercepted,
    emitApproved,
    emitRejected,
    emitApprovedWithModifications,
    emitDecision,
    emitError,
} from "./cloudflare-observability";

/** 30s heartbeat keeps the DO alive; Cloudflare evicts after ~70–140s inactivity. */
const LETSPING_TRIAGE_BASE = "https://letsping.co/requests";

export interface CloudflareAdapterContext {
    /**
     * Pass your Agent's keepAliveWhile so the Durable Object stays alive during
     * LetsPing Cryo-Sleep (HITL wait, escrow settlement). Without this, long
     * approvals or x402 flows can cause the DO to be evicted mid-flight.
     */
    keepAliveWhile: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CreateLetsPingCloudflareToolOptions<T extends z.ZodType> {
    name: string;
    description: string;
    schema: T;
    apiKey: string;
    service?: string;
    priority?: "low" | "medium" | "high" | "critical";
    timeoutMs?: number;
    /**
     * When running inside a Cloudflare Agent (Durable Object), pass the agent
     * context so the adapter can call keepAliveWhile() during ask() / waitForDecision().
     */
    cloudflare?: CloudflareAdapterContext;
    /**
     * Optional handler to run after approval (e.g. call MCP server, run shell).
     * Receives the approved (possibly patched) payload.
     */
    handler?: (args: z.infer<T>) => Promise<unknown> | unknown;
}

/**
 * Run an async function inside keepAliveWhile when Cloudflare context is provided.
 * Otherwise run normally (for testing or non-Cloudflare runtimes).
 */
async function withKeepAlive<T>(
    fn: () => Promise<T>,
    ctx: CloudflareAdapterContext | undefined
): Promise<T> {
    if (ctx?.keepAliveWhile) {
        return ctx.keepAliveWhile(fn);
    }
    return fn();
}

/**
 * Create a LetsPing tool for Cloudflare Agents.
 *
 * - Wraps ask() in keepAliveWhile() so the Durable Object is not evicted during
 *   human approval or escrow settlement.
 * - Publishes events to diagnostics_channel (agents:letsping_firewall) so Tail
 *   Workers show intercepts, approvals, rejections, and errors.
 *
 * Use in your Agent's tool list; when the model invokes the tool, execution
 * pauses until the request is approved or rejected in the LetsPing dashboard.
 */
export function createLetsPingCloudflareTool<T extends z.ZodType>(
    options: CreateLetsPingCloudflareToolOptions<T>
) {
    const { cloudflare, apiKey, name, description, schema, handler } = options;
    if (!apiKey) {
        throw new Error("LetsPing Cloudflare Adapter: 'apiKey' is required.");
    }

    const lp = new LetsPing(apiKey);
    const service = options.service ?? "cloudflare-agent";
    const priority = options.priority ?? "medium";
    const timeoutMs = options.timeoutMs;

    async function execute(args: z.infer<T>): Promise<Record<string, unknown> | string> {
        const requestOptions: RequestOptions = {
            service,
            action: name,
            payload: args as Record<string, unknown>,
            priority,
            schema: undefined,
            timeoutMs,
            environment: "cloudflare",
        };

        let requestId: string | undefined;

        try {
            emitIntercepted({
                request_id: "pending",
                service,
                action: name,
            });

            const decision = await withKeepAlive(async (): Promise<Decision> => {
                return lp.ask(requestOptions);
            }, cloudflare);

            requestId = (decision as any).request_id ?? "unknown";
            const triageUrl = requestId !== "unknown" ? `${LETSPING_TRIAGE_BASE}/${requestId}` : undefined;

            if (decision.status === "REJECTED") {
                emitRejected({
                    request_id: requestId ?? "unknown",
                    service,
                    action: name,
                    resolved_at: decision.metadata?.resolved_at,
                    actor_id: decision.metadata?.actor_id,
                    metadata: decision.metadata,
                });
                emitDecision({
                    request_id: requestId ?? "unknown",
                    status: "REJECTED",
                    service,
                    action: name,
                    metadata: decision.metadata,
                });
                return {
                    status: "REJECTED",
                    message: "The human operator denied this request. Do not proceed.",
                    metadata: decision.metadata,
                };
            }

            const executedInput = decision.patched_payload ?? decision.payload;
            let executionOutput: unknown;
            if (handler) {
                executionOutput = await handler(executedInput as z.infer<T>);
            }

            if (decision.status === "APPROVED_WITH_MODIFICATIONS") {
                emitApprovedWithModifications({
                    request_id: requestId ?? "unknown",
                    service,
                    action: name,
                    diff_summary: decision.diff_summary,
                    resolved_at: decision.metadata?.resolved_at,
                    actor_id: decision.metadata?.actor_id,
                });
                emitDecision({
                    request_id: requestId ?? "unknown",
                    status: "APPROVED_WITH_MODIFICATIONS",
                    service,
                    action: name,
                    payload: decision.payload,
                    patched_payload: decision.patched_payload,
                    metadata: decision.metadata,
                });
                const letspingContext = {
                    status: "APPROVED_WITH_MODIFICATIONS",
                    message: "The human reviewer modified the payload. Review diff_summary.",
                    diff_summary: decision.diff_summary,
                    original_input: decision.payload,
                    executed_input: executedInput,
                    metadata: decision.metadata,
                };
                return handler
                    ? { letsping_context: letspingContext, execution_output: executionOutput }
                    : letspingContext;
            }

            emitApproved({
                request_id: requestId ?? "unknown",
                service,
                action: name,
                resolved_at: decision.metadata?.resolved_at,
                actor_id: decision.metadata?.actor_id,
            });
            emitDecision({
                request_id: requestId ?? "unknown",
                status: "APPROVED",
                service,
                action: name,
                payload: decision.payload,
                metadata: decision.metadata,
            });
            const letspingContext = {
                status: "APPROVED",
                executed_input: executedInput,
                metadata: decision.metadata,
            };
            return handler
                ? { letsping_context: letspingContext, execution_output: executionOutput }
                : letspingContext;
        } catch (error: unknown) {
            const err = error as { message?: string; code?: string; status?: number };
            emitError({
                code: err?.code,
                message: err?.message ?? "LetsPing approval failed",
                request_id: requestId,
                status: err?.status,
            });
            return {
                status: "ERROR",
                error: err?.message ?? "Control plane unreachable or request timed out.",
                suggestion: "Inform the user that the approval request failed.",
            };
        }
    }

    return {
        name,
        description: `${description} [SYSTEM: This tool pauses for human approval via LetsPing. Do not expect an immediate result.]`,
        schema,
        execute,
    };
}

/**
 * Non-blocking flow: defer then waitForDecision, both inside keepAliveWhile.
 * Use when you need to yield progress (e.g. triage_url) before blocking.
 */
export interface CreateLetsPingCloudflareDeferToolOptions<T extends z.ZodType>
    extends CreateLetsPingCloudflareToolOptions<T> {
    /**
     * Called once when the request is deferred, with id and triage_url.
     * Use to show "Waiting for approval" in the UI or stream.
     */
    onIntercepted?: (params: { request_id: string; triage_url: string }) => void;
}

/**
 * Create a tool that uses defer() + waitForDecision() so you can emit progress
 * (e.g. triage_url) before blocking. Still wrapped in keepAliveWhile during wait.
 */
/** Defer flow: get request_id and triage_url immediately, then wait inside keepAliveWhile. */
export function createLetsPingCloudflareDeferTool<T extends z.ZodType>(
    options: CreateLetsPingCloudflareDeferToolOptions<T>
): { name: string; description: string; schema: T; execute: (args: z.infer<T>) => Promise<Record<string, unknown> | string> } {
    const { cloudflare, apiKey, name, description, schema, handler, onIntercepted } = options;
    if (!apiKey) {
        throw new Error("LetsPing Cloudflare Adapter: 'apiKey' is required.");
    }

    const lp = new LetsPing(apiKey);
    const service = options.service ?? "cloudflare-agent";
    const priority = options.priority ?? "medium";
    const timeoutMs = options.timeoutMs;

    async function execute(args: z.infer<T>): Promise<Record<string, unknown> | string> {
    const requestOptions: RequestOptions = {
        service,
        action: name,
        payload: args as Record<string, unknown>,
        priority,
        schema: undefined,
        timeoutMs,
        environment: "cloudflare",
    };

        let requestId: string | undefined;

        try {
            const { id } = await lp.defer(requestOptions);
            requestId = id;
            const triageUrl = `${LETSPING_TRIAGE_BASE}/${id}`;
            emitIntercepted({ request_id: id, service, action: name, triage_url: triageUrl });
            onIntercepted?.({ request_id: id, triage_url: triageUrl });

            const decision = await withKeepAlive(
                () =>
                    lp.waitForDecision(id, {
                        originalPayload: args as Record<string, unknown>,
                        timeoutMs,
                    }),
                cloudflare
            );

            if (decision.status === "REJECTED") {
                emitRejected({
                    request_id: id,
                    service,
                    action: name,
                    resolved_at: decision.metadata?.resolved_at,
                    actor_id: decision.metadata?.actor_id,
                    metadata: decision.metadata,
                });
                emitDecision({
                    request_id: id,
                    status: "REJECTED",
                    service,
                    action: name,
                    metadata: decision.metadata,
                });
                return {
                    status: "REJECTED",
                    message: "The human operator denied this request. Do not proceed.",
                    metadata: decision.metadata,
                };
            }

            const executedInput = decision.patched_payload ?? decision.payload;
            let executionOutput: unknown;
            if (handler) {
                executionOutput = await handler(executedInput as z.infer<T>);
            }

            if (decision.status === "APPROVED_WITH_MODIFICATIONS") {
                emitApprovedWithModifications({
                    request_id: id,
                    service,
                    action: name,
                    diff_summary: decision.diff_summary,
                    resolved_at: decision.metadata?.resolved_at,
                    actor_id: decision.metadata?.actor_id,
                });
                emitDecision({
                    request_id: id,
                    status: "APPROVED_WITH_MODIFICATIONS",
                    service,
                    action: name,
                    payload: decision.payload,
                    patched_payload: decision.patched_payload,
                    metadata: decision.metadata,
                });
                const letspingContext = {
                    status: "APPROVED_WITH_MODIFICATIONS",
                    message: "The human reviewer modified the payload. Review diff_summary.",
                    diff_summary: decision.diff_summary,
                    original_input: decision.payload,
                    executed_input: executedInput,
                    metadata: decision.metadata,
                };
                return handler
                    ? { letsping_context: letspingContext, execution_output: executionOutput }
                    : letspingContext;
            }

            emitApproved({
                request_id: id,
                service,
                action: name,
                resolved_at: decision.metadata?.resolved_at,
                actor_id: decision.metadata?.actor_id,
            });
            emitDecision({
                request_id: id,
                status: "APPROVED",
                service,
                action: name,
                payload: decision.payload,
                metadata: decision.metadata,
            });
            const letspingContext = {
                status: "APPROVED",
                executed_input: executedInput,
                metadata: decision.metadata,
            };
            return handler
                ? { letsping_context: letspingContext, execution_output: executionOutput }
                : letspingContext;
        } catch (error: unknown) {
            const err = error as { message?: string; code?: string; status?: number };
            emitError({
                code: err?.code,
                message: err?.message ?? "LetsPing approval failed",
                request_id: requestId,
                status: err?.status,
            });
            return {
                status: "ERROR",
                error: err?.message ?? "Control plane unreachable or request timed out.",
                suggestion: "Inform the user that the approval request failed.",
            };
        }
    }

    return {
        name,
        description: `${description} [SYSTEM: This tool pauses for human approval via LetsPing. Do not expect an immediate result.]`,
        schema,
        execute,
    };
}

export {
    mcpToolCallToRequestOptions,
    isMcpToolCallRequest,
    type McpToolCallParams,
    type McpToolCallRequest,
} from "./cloudflare-mcp";
