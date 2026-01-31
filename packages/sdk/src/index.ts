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
            console.warn("\x1b[33m%s\x1b[0m", "⚠️ LetsPing Warning: It looks like you passed a raw Zod object to 'schema'. This will result in an empty form. Please convert it to JSON Schema first (e.g. using 'zod-to-json-schema').");
        }

        const { id } = await this.request<{ id: string }>("POST", "/ingest", {
            service: options.service,
            action: options.action,
            payload: options.payload,
            priority: options.priority || "medium",
            schema: options.schema
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
                        payload: options.payload,
                        patched_payload: check.patched_payload || options.payload,
                        metadata: {
                            resolved_at: check.resolved_at,
                            actor_id: check.actor_id
                        }
                    };
                }
            } catch (e: any) {
                if (e.status !== 404 && e.status !== 429) throw e;
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
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "letsping-node/0.1.0"
        };

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new LetsPingError(`LetsPing API Error [${response.status}]: ${errorText}`, response.status);
            }

            return response.json() as Promise<T>;
        } catch (e: any) {
            if (e instanceof LetsPingError) throw e;
            throw new LetsPingError(`Network Error: ${e.message}`);
        }
    }
}