/**
 * LetsPing observability for Cloudflare Agents (Tail Workers).
 * Publishes structured events to Node's diagnostics_channel so they flow
 * into Cloudflare's Tail Worker firehose alongside agents:state, agents:rpc, etc.
 *
 * Channel: agents:letsping_firewall
 * Event shape: { type, payload, timestamp }
 *
 * @see https://developers.cloudflare.com/agents/api-reference/observability/
 * @see https://developers.cloudflare.com/workers/observability/logs/tail-workers/
 */

import { channel } from "node:diagnostics_channel";

export const LETSPING_FIREWALL_CHANNEL = "agents:letsping_firewall";

function getChannel() {
    try {
        return channel(LETSPING_FIREWALL_CHANNEL);
    } catch {
        return null;
    }
}

export type LetsPingFirewallEventType =
    | "letsping:intercepted"
    | "letsping:approved"
    | "letsping:rejected"
    | "letsping:approved_with_modifications"
    | "letsping:escrow_settled"
    | "letsping:decision"
    | "letsping:error";

export interface LetsPingFirewallEventPayload {
    type: LetsPingFirewallEventType;
    payload: Record<string, unknown>;
    timestamp: number;
}

function publishEvent(type: LetsPingFirewallEventType, payload: Record<string, unknown>) {
    const ch = getChannel();
    if (!ch) return;
    try {
        ch.publish({
            type,
            payload,
            timestamp: Date.now(),
        } as LetsPingFirewallEventPayload);
    } catch {
        // no-op if no subscribers or runtime doesn't support it
    }
}

/**
 * Emit when a request is parked in Cryo-Sleep (defer or ask polling started).
 * Tail Workers will show this so operators see "waiting for approval" in the dashboard.
 */
export function emitIntercepted(params: {
    request_id: string;
    service: string;
    action: string;
    triage_url?: string;
}) {
    publishEvent("letsping:intercepted", params);
}

/**
 * Emit when a request is approved with no modifications.
 */
export function emitApproved(params: {
    request_id: string;
    service: string;
    action: string;
    resolved_at?: string;
    actor_id?: string;
}) {
    publishEvent("letsping:approved", params);
}

/**
 * Emit when a request is rejected by the human operator.
 */
export function emitRejected(params: {
    request_id: string;
    service: string;
    action: string;
    resolved_at?: string;
    actor_id?: string;
    metadata?: Record<string, unknown>;
}) {
    publishEvent("letsping:rejected", params);
}

/**
 * Emit when a request is approved with payload modifications (RLHF-style correction).
 */
export function emitApprovedWithModifications(params: {
    request_id: string;
    service: string;
    action: string;
    diff_summary?: unknown;
    resolved_at?: string;
    actor_id?: string;
}) {
    publishEvent("letsping:approved_with_modifications", params);
}

/**
 * Emit when an escrow or x402 settlement completes (e.g. A2A payment).
 * Include transaction_hash / amount when the backend provides them in response metadata.
 */
export function emitEscrowSettled(params: {
    request_id?: string;
    transaction_hash?: string;
    amount?: number;
    currency?: string;
    [key: string]: unknown;
}) {
    publishEvent("letsping:escrow_settled", params);
}

/**
 * Generic decision event for custom Tail Worker filtering.
 * Use when you want a single event type with status and full payload.
 */
export function emitDecision(params: {
    request_id: string;
    status: "APPROVED" | "REJECTED" | "APPROVED_WITH_MODIFICATIONS";
    service: string;
    action: string;
    payload?: unknown;
    patched_payload?: unknown;
    metadata?: Record<string, unknown>;
}) {
    publishEvent("letsping:decision", params);
}

/**
 * Emit when the firewall or SDK returns an error (402, 429, timeout, network).
 */
export function emitError(params: {
    code?: string;
    message: string;
    request_id?: string;
    status?: number;
}) {
    publishEvent("letsping:error", params);
}
