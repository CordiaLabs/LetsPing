/**
 * MCP (Model Context Protocol) helpers for the Cloudflare adapter.
 *
 * Cloudflare Agents SDK v0.7+ standardizes on MCP for tool use. LetsPing can sit
 * between the agent and MCP servers as a secure proxy: intercept MCP tool calls,
 * send them through the firewall (ask/defer), then forward approved payloads to
 * the MCP server (or run them locally).
 *
 * Use mcpToolCallToRequestOptions() to turn a tools/call JSON-RPC params into
 * LetsPing RequestOptions so you can ask() or defer() before executing the tool.
 *
 * @see https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/
 * @see https://developers.cloudflare.com/changelog/post/2026-03-02-agents-sdk-v070/
 */

import type { RequestOptions } from "@letsping/sdk";

/**
 * MCP tools/call JSON-RPC params shape.
 * method: "tools/call", params: { name, arguments }
 */
export interface McpToolCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}

/**
 * Full MCP JSON-RPC request for tools/call (for reference).
 */
export interface McpToolCallRequest {
    jsonrpc: "2.0";
    id: string | number;
    method: "tools/call";
    params: McpToolCallParams;
}

/**
 * Convert MCP tools/call params to LetsPing RequestOptions.
 * Use this to firewall MCP tool invocations: when your agent receives an MCP
 * tool call, map it to a LetsPing request so a human can approve before the
 * tool is executed (or before the call is forwarded to the MCP server).
 *
 * @param params - MCP params (name + arguments)
 * @param options - service name (default "mcp"), priority, role
 * @returns RequestOptions ready for lp.ask() or lp.defer()
 *
 * @example
 * // In your Cloudflare Agent, when handling an MCP tool call:
 * const requestOptions = mcpToolCallToRequestOptions(
 *   { name: "execute_sql", arguments: { query: "DROP TABLE users" } },
 *   { service: "mcp-database", priority: "high" }
 * );
 * const decision = await this.keepAliveWhile(() => lp.ask(requestOptions));
 * if (decision.status === "APPROVED") {
 *   return await forwardToMcpServer(decision.patched_payload ?? decision.payload);
 * }
 */
export function mcpToolCallToRequestOptions(
    params: McpToolCallParams,
    options?: {
        service?: string;
        priority?: RequestOptions["priority"];
        role?: string;
        schema?: RequestOptions["schema"];
    }
): RequestOptions {
    const service = options?.service ?? "mcp";
    const priority = options?.priority ?? "medium";
    return {
        service,
        action: params.name,
        payload: params.arguments ?? {},
        priority,
        role: options?.role,
        schema: options?.schema,
    };
}

/**
 * Type guard: true if the value looks like an MCP tools/call request.
 */
export function isMcpToolCallRequest(value: unknown): value is McpToolCallRequest {
    if (typeof value !== "object" || value === null) return false;
    const o = value as Record<string, unknown>;
    return (
        o.method === "tools/call" &&
        typeof o.params === "object" &&
        o.params !== null &&
        "name" in (o.params as object)
    );
}
