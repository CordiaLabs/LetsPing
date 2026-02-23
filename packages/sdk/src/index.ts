import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

let SDK_VERSION = "0.1.2";
try {
    
    SDK_VERSION = require("../package.json").version;
} catch {  }

export type Priority = "low" | "medium" | "high" | "critical";

export interface RequestOptions {
    
    service: string;
    
    action: string;
    
    payload: Record<string, any>;
    
    priority?: Priority;
    
    schema?: Record<string, any>;
    
    timeoutMs?: number;
    
    role?: string;
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

export class LetsPingError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = "LetsPingError";
    }
}

interface EncEnvelope {
    _lp_enc: true;
    iv: string;  
    ct: string;  
}

function isEncEnvelope(v: unknown): v is EncEnvelope {
    return (
        typeof v === "object" && v !== null &&
        (v as any)._lp_enc === true &&
        typeof (v as any).iv === "string" &&
        typeof (v as any).ct === "string"
    );
}

function encryptPayload(keyBase64: string, payload: Record<string, any>): EncEnvelope {
    const keyBuf = Buffer.from(keyBase64, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBuf, iv);
    const plain = Buffer.from(JSON.stringify(payload), "utf8");
    const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    return {
        _lp_enc: true,
        iv: iv.toString("base64"),
        ct: ct.toString("base64"),
    };
}

function decryptPayload(keyBase64: string, envelope: EncEnvelope): Record<string, any> {
    const keyBuf = Buffer.from(keyBase64, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const ctFull = Buffer.from(envelope.ct, "base64");
    
    const authTag = ctFull.subarray(ctFull.length - 16);
    const ct = ctFull.subarray(0, ctFull.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
}

function computeDiff(original: any, patched: any): any {
    if (original === patched) return null;

    if (
        typeof original !== "object" ||
        typeof patched !== "object" ||
        original === null ||
        patched === null ||
        Array.isArray(original) ||
        Array.isArray(patched)
    ) {
        if (JSON.stringify(original) !== JSON.stringify(patched)) {
            return { from: original, to: patched };
        }
        return null;
    }

    const changes: Record<string, any> = {};
    let hasChanges = false;
    const allKeys = new Set([...Object.keys(original), ...Object.keys(patched)]);

    for (const key of allKeys) {
        const oV = original[key];
        const pV = patched[key];

        if (!(key in original)) {
            changes[key] = { from: undefined, to: pV };
            hasChanges = true;
        } else if (!(key in patched)) {
            changes[key] = { from: oV, to: undefined };
            hasChanges = true;
        } else {
            const nestedDiff = computeDiff(oV, pV);
            if (nestedDiff) {
                changes[key] = nestedDiff;
                hasChanges = true;
            }
        }
    }

    return hasChanges ? changes : null;
}

export class LetsPing {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly encryptionKey: string | null;

    constructor(apiKey?: string, options?: { baseUrl?: string; encryptionKey?: string }) {
        const key = apiKey || process.env.LETSPING_API_KEY;
        if (!key) throw new Error("LetsPing: API Key is required. Pass it to the constructor or set LETSPING_API_KEY env var.");

        this.apiKey = key;
        this.baseUrl = options?.baseUrl || "https://letsping.co/api";
        this.encryptionKey = options?.encryptionKey
            ?? process.env.LETSPING_ENCRYPTION_KEY
            ?? null;
    }

    private _encrypt(payload: Record<string, any>): Record<string, any> {
        if (!this.encryptionKey) return payload;
        return encryptPayload(this.encryptionKey, payload) as any;
    }

    private _decrypt(val: any): any {
        if (!this.encryptionKey || !isEncEnvelope(val)) return val;
        try {
            return decryptPayload(this.encryptionKey, val);
        } catch {
            
            return val;
        }
    }

    async ask(options: RequestOptions): Promise<Decision> {
        if (options.schema && (options.schema as any)._def) {
            throw new LetsPingError("LetsPing Error: Raw Zod schema detected. You must convert it to JSON Schema (e.g. using 'zod-to-json-schema') before passing it to the SDK.");
        }

        const { id } = await this.request<{ id: string }>("POST", "/ingest", {
            service: options.service,
            action: options.action,
            payload: this._encrypt(options.payload),
            priority: options.priority || "medium",
            schema: options.schema,
            metadata: { role: options.role, sdk: "node" }
        });

        const timeout = options.timeoutMs || 24 * 60 * 60 * 1000;
        const start = Date.now();
        let delay = 1000;
        const maxDelay = 10000;

        while (Date.now() - start < timeout) {
            try {
                const check = await this.request<any>("GET", `/status/${id}`);

                if (check.status === "APPROVED" || check.status === "REJECTED") {
                    const decryptedPayload = this._decrypt(check.payload) ?? options.payload;
                    const decryptedPatched = check.patched_payload ? this._decrypt(check.patched_payload) : undefined;

                    let diff_summary;
                    let finalStatus = check.status;
                    if (check.status === "APPROVED" && decryptedPatched !== undefined) {
                        finalStatus = "APPROVED_WITH_MODIFICATIONS";
                        const diff = computeDiff(decryptedPayload, decryptedPatched);
                        diff_summary = diff ? { changes: diff } : { changes: "Unknown structure changes" };
                    }

                    return {
                        status: finalStatus,
                        payload: decryptedPayload,
                        patched_payload: decryptedPatched,
                        diff_summary,
                        metadata: {
                            resolved_at: check.resolved_at,
                            actor_id: check.actor_id,
                        }
                    };
                }
            } catch (e: any) {
                const s = e.status;
                if (s && s >= 400 && s < 500 && s !== 404 && s !== 429) throw e;
            }

            const jitter = Math.random() * 200;
            await new Promise(r => setTimeout(r, delay + jitter));
            delay = Math.min(delay * 1.5, maxDelay);
        }

        throw new LetsPingError(`Request ${id} timed out waiting for approval.`);
    }

    async defer(options: RequestOptions): Promise<{ id: string }> {
        return this.request<{ id: string }>("POST", "/ingest", {
            ...options,
            payload: this._encrypt(options.payload),
        });
    }

    private async request<T>(method: string, path: string, body?: any): Promise<T> {
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": `letsping-node/${SDK_VERSION}`,
        };

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                const errorText = await response.text();
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
            throw new LetsPingError(`Network Error: ${e.message}`);
        }
    }

    tool(service: string, action: string, priority: Priority = "medium"): (context: string | Record<string, any>) => Promise<string> {
        return async (context: string | Record<string, any>): Promise<string> => {
            let payload: Record<string, any>;
            try {
                if (typeof context === "string") {
                    try { payload = JSON.parse(context); }
                    catch { payload = { raw_context: context }; }
                } else if (typeof context === "object" && context !== null) {
                    payload = context;
                } else {
                    payload = { raw_context: String(context) };
                }

                const result = await this.ask({ service, action, payload, priority });

                if (result.status === "REJECTED") {
                    return "STOP: Action Rejected by Human.";
                }

                if (result.status === "APPROVED_WITH_MODIFICATIONS") {
                    return JSON.stringify({
                        status: "APPROVED_WITH_MODIFICATIONS",
                        message: "The human reviewer authorized this action but modified your original payload. Please review the diff_summary to learn from this correction.",
                        diff_summary: result.diff_summary,
                        original_payload: result.payload,
                        executed_payload: result.patched_payload
                    });
                }

                return JSON.stringify({
                    status: "APPROVED",
                    executed_payload: result.payload
                });
            } catch (e: any) {
                return `ERROR: System Failure: ${e.message}`;
            }
        };
    }
}

export { computeDiff };