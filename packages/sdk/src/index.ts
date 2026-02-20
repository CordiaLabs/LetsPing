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
    status: "APPROVED" | "REJECTED";
    /** The reason provided if the request was rejected */
    reason?: string;
    /** The original payload submitted */
    payload: any;
    /** The modified payload if the human edited values during approval */
    patched_payload?: any;
    metadata?: {
        resolved_at: string;
        actor_id: string;
        method?: string;
    };
}

export class LetsPingError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = "LetsPingError";
    }
}

export class LetsPing {
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(apiKey?: string, options?: { baseUrl?: string }) {
        const key = apiKey || process.env.LETSPING_API_KEY;
        if (!key) throw new Error("LetsPing: API Key is required. Pass it to the constructor or set LETSPING_API_KEY env var.");

        this.apiKey = key;
        this.baseUrl = options?.baseUrl || "https://letsping.co/api";
    }

    async ask(options: RequestOptions): Promise<Decision> {
        if (options.schema && (options.schema as any)._def) {
            throw new LetsPingError("LetsPing Error: Raw Zod schema detected. You must convert it to JSON Schema (e.g. using 'zod-to-json-schema') before passing it to the SDK.");
        }

        const { id } = await this.request<{ id: string }>("POST", "/ingest", {
            service: options.service,
            action: options.action,
            payload: options.payload,
            priority: options.priority || "medium",
            schema: options.schema,
            metadata: {
                role: options.role,
                sdk: "node"
            }
        });

        const timeout = options.timeoutMs || 24 * 60 * 60 * 1000;
        const start = Date.now();
        let delay = 1000;
        const maxDelay = 10000;

        while (Date.now() - start < timeout) {
            try {
                const check = await this.request<any>("GET", `/status/${id}`);

                if (check.status === "APPROVED" || check.status === "REJECTED") {
                    return {
                        status: check.status,
                        reason: check.reason,
                        payload: options.payload,
                        patched_payload: check.patched_payload || options.payload,
                        metadata: {
                            resolved_at: check.resolved_at,
                            actor_id: check.actor_id
                        }
                    };
                }
            } catch (e: any) {
                // Retry on:
                // 1. Network errors (status is undefined)
                // 2. 404 (not found yet)
                // 3. 429 (rate limit)
                // 4. 5xx (server error)
                // Fail on: 400, 401, 403 (client errors)
                const status = e.status;
                if (status && status >= 400 && status < 500 && status !== 404 && status !== 429) {
                    throw e;
                }
            }

            const jitter = Math.random() * 200;
            await new Promise(r => setTimeout(r, delay + jitter));
            delay = Math.min(delay * 1.5, maxDelay);
        }

        throw new LetsPingError(`Request ${id} timed out waiting for approval.`);
    }

    async defer(options: RequestOptions): Promise<{ id: string }> {
        return this.request<{ id: string }>("POST", "/ingest", options);
    }

    private async request<T>(method: string, path: string, body?: any): Promise<T> {
        // Shared headers
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "letsping-node/0.1.2"
        };

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                const errorText = await response.text();
                // Try parsing JSON error message
                let message = errorText;
                try {
                    const json = JSON.parse(errorText);
                    if (json.message) message = json.message;
                } catch { }

                throw new LetsPingError(`API Error [${response.status}]: ${message}`, response.status);
            }

            return response.json() as Promise<T>;
        } catch (e: any) {
            if (e instanceof LetsPingError) throw e;
            // Fetch/Network errors
            throw new LetsPingError(`Network Error: ${e.message}`);
        }
    }
    tool(service: string, action: string, priority: Priority = "medium"): (context: string | Record<string, any>) => Promise<string> {
        return async (context: string | Record<string, any>): Promise<string> => {
            let payload: Record<string, any>;
            try {
                if (typeof context === 'string') {
                    try {
                        payload = JSON.parse(context);
                    } catch {
                        payload = { raw_context: context };
                    }
                } else if (typeof context === 'object' && context !== null) {
                    payload = context;
                } else {
                    // Handle numbers, booleans, undefined, etc.
                    payload = { raw_context: String(context) };
                }

                const result = await this.ask({
                    service,
                    action,
                    payload,
                    priority
                });

                if (result.status === "REJECTED") {
                    return `STOP: Action Rejected by Human. Reason: ${result.reason || "No reason provided."}`;
                }

                const finalPayload = result.patched_payload || result.payload;
                return JSON.stringify(finalPayload);
            } catch (e: any) {
                return `ERROR: System Failure: ${e.message}`;
            }
        };
    }
}