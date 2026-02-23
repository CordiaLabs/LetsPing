export type Priority = "low" | "medium" | "high" | "critical";
/**
 * Options for configuring a LetsPing approval request.
 */
export interface RequestOptions {
    /** Name of the agent or service (e.g., "billing-agent") */
    service: string;
    /** Specific action being requested (e.g., "refund_user") */
    action: string;
    /** The data payload to be reviewed by the human */
    payload: Record<string, any>;
    /** Urgency level affecting notification routing (default: "medium") */
    priority?: Priority;
    /** JSON Schema (Draft 7) for rendering a structured form in the dashboard */
    schema?: Record<string, any>;
    /** Maximum time to wait for approval in milliseconds (default: 24h) */
    timeoutMs?: number;
    /** (Enterprise) Specific role required for approval (e.g., "finance") */
    role?: string;
}
/**
 * The result of a human approval decision.
 */
export interface Decision {
    status: "APPROVED" | "REJECTED" | "APPROVED_WITH_MODIFICATIONS";
    /** The original payload submitted */
    payload: any;
    /** The modified payload if the human edited values during approval */
    patched_payload?: any;
    /** Structural diff of the modifications */
    diff_summary?: any;
    metadata?: {
        resolved_at: string;
        actor_id: string;
        method?: string;
    };
}
export declare class LetsPingError extends Error {
    status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export declare function computeDiff(original: any, patched: any): any;
export declare class LetsPing {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly encryptionKey;
    /**
     * @param apiKey         Your LetsPing API key (or set LETSPING_API_KEY env var).
     * @param options.encryptionKey
     *   Optional base64-encoded AES-256 key for payload encryption.
     *   If not provided here, the SDK reads LETSPING_ENCRYPTION_KEY from process.env.
     *   Generate once from the dashboard (Settings → Encryption).
     *   When set, all payloads are encrypted before leaving this process.
     *   LetsPing's backend never sees plaintext values.
     */
    constructor(apiKey?: string, options?: {
        baseUrl?: string;
        encryptionKey?: string;
    });
    private _encrypt;
    private _decrypt;
    ask(options: RequestOptions): Promise<Decision>;
    defer(options: RequestOptions): Promise<{
        id: string;
    }>;
    private request;
    tool(service: string, action: string, priority?: Priority): (context: string | Record<string, any>) => Promise<string>;
}
