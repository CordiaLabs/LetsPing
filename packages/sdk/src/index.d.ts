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
    status: "APPROVED" | "REJECTED";
    payload: any;
    patched_payload?: any;
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
export declare class LetsPing {
    private readonly apiKey;
    private readonly baseUrl;
    constructor(apiKey?: string, options?: {
        baseUrl?: string;
    });
    ask(options: RequestOptions): Promise<Decision>;
    defer(options: RequestOptions): Promise<{
        id: string;
    }>;
    private request;
}
