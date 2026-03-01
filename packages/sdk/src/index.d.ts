export type Priority = "low" | "medium" | "high" | "critical";
export interface RequestOptions {
    service: string;
    action: string;
    payload: Record<string, any>;
    priority?: Priority;
    schema?: Record<string, any>;
    timeoutMs?: number;
}
export interface Decision {
    status: "APPROVED" | "REJECTED" | "APPROVED_WITH_MODIFICATIONS";
    payload: any;
    patched_payload?: any;
    diff_summary?: any;
    metadata?: {
        resolved_at: string;
        actor_id: string;
        method?: string;
    };
}
export interface EscrowEnvelope {
    id: string;
    event: string;
    data: any;
    escrow?: {
        mode: "none" | "handoff" | "finalized";
        handoff_signature: string | null;
        upstream_agent_id: string | null;
        downstream_agent_id: string | null;
        x402_mandate?: any;
        ap2_mandate?: any;
    };
}
export declare function verifyEscrow(event: EscrowEnvelope, secret: string): boolean;
export interface AgentCallPayload {
    project_id: string;
    service: string;
    action: string;
    payload: any;
}
export declare function signAgentCall(agentId: string, secret: string, call: AgentCallPayload): {
    agent_id: string;
    agent_signature: string;
};
export declare function signIngestBody(agentId: string, secret: string, body: {
    project_id: string;
    service: string;
    action: string;
    payload: any;
}): {
    project_id: string;
    service: string;
    action: string;
    payload: any;
    agent_id: string;
    agent_signature: string;
};
export declare function verifyAgentSignature(agentId: string, secret: string, call: AgentCallPayload, signature: string): boolean;

export interface AgentWorkspaceCredentials {
    project_id: string;
    api_key: string;
    ingest_url: string;
    agents_register_url: string;
    agent_id: string;
    agent_secret: string;
    org_id?: string;
    docs_url?: string;
}
export declare function createAgentWorkspace(options?: { baseUrl?: string }): Promise<AgentWorkspaceCredentials>;

export interface IngestWithAgentSignatureOptions {
    projectId: string;
    ingestUrl: string;
    apiKey: string;
}
export interface IngestPayload {
    service: string;
    action: string;
    payload: Record<string, any>;
}
export declare function ingestWithAgentSignature(
    agentId: string,
    agentSecret: string,
    payload: IngestPayload,
    options: IngestWithAgentSignatureOptions
): Promise<Record<string, any>>;
export declare function chainHandoff(previous: EscrowEnvelope, nextData: {
    service: string;
    action: string;
    payload: any;
    upstream_agent_id: string;
    downstream_agent_id: string;
}, secret: string): {
    payload: any;
    escrow: {
        mode: "handoff";
        upstream_agent_id: string;
        downstream_agent_id: string;
        handoff_signature: string;
    };
};
export declare const LETSPING_DOCS_BASE: string;
export type LetsPingErrorCode = "LETSPING_401_AUTH" | "LETSPING_402_QUOTA" | "LETSPING_403_FORBIDDEN" | "LETSPING_404_NOT_FOUND" | "LETSPING_429_RATE_LIMIT" | "LETSPING_TIMEOUT" | "LETSPING_NETWORK" | "LETSPING_WEBHOOK_INVALID" | string;
export declare class LetsPingError extends Error {
    status?: number;
    code?: LetsPingErrorCode;
    documentationUrl?: string;
    constructor(message: string, status?: number, code?: LetsPingErrorCode, documentationUrl?: string);
}
export interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}
export interface RequestStatus {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    payload?: any;
    patched_payload?: any;
    resolved_at?: string | null;
    actor_id?: string | null;
}
export declare class LetsPing {
    constructor(apiKey?: string, options?: {
        baseUrl?: string;
        encryptionKey?: string;
        retry?: RetryOptions;
    });
    ask(options: RequestOptions): Promise<Decision>;
    defer(options: RequestOptions): Promise<{ id: string }>;
    waitForDecision(id: string, options?: { originalPayload?: Record<string, any>; timeoutMs?: number }): Promise<Decision>;
    getRequestStatus(id: string): Promise<RequestStatus>;
    tool(service: string, action: string, priority?: Priority): (context: string | Record<string, any>) => Promise<string>;
    webhookHandler(payloadStr: string, signatureHeader: string, webhookSecret: string): Promise<{ id: string; event: string; data: Decision; state_snapshot?: Record<string, any> }>;
}
