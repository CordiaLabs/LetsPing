import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

let SDK_VERSION = "0.2.0";
try {

    SDK_VERSION = require("../package.json").version;
} catch { }

let otelApi: any = null;
let otelTried = false;

async function getOtel() {
    if (otelTried) return otelApi;
    otelTried = true;
    try {
        otelApi = await import("@opentelemetry/api");
    } catch { }
    return otelApi;
}

export type Priority = "low" | "medium" | "high" | "critical";

export interface RequestOptions {

    service: string;

    action: string;

    payload: Record<string, any>;

    priority?: Priority;

    schema?: Record<string, any>;

    state_snapshot?: Record<string, any>;

    timeoutMs?: number;

    role?: string;

    /**
     * Optional distributed tracing identifiers. If provided, these will be
     * attached to the request envelope so downstream frameworks can stitch
     * together multi-agent flows.
     */
    trace_id?: string;
    parent_request_id?: string;
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

    private _prepareStateUpload(
        stateSnapshot: Record<string, any>,
        fallbackDek?: string
    ): { data: any; contentType: string } {
        if (this.encryptionKey) {
            return {
                data: this._encrypt(stateSnapshot),
                contentType: "application/json"
            };
        } else if (fallbackDek) {
            const keyBuf = Buffer.from(fallbackDek, "base64");
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", keyBuf, iv);
            const plain = Buffer.from(JSON.stringify(stateSnapshot), "utf8");
            const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
            const finalPayload = Buffer.concat([iv, ct]);

            return {
                data: finalPayload,
                contentType: "application/octet-stream"
            };
        }
        return {
            data: stateSnapshot,
            contentType: "application/json"
        };
    }

    async ask(options: RequestOptions): Promise<Decision> {
        if (options.schema && (options.schema as any)._def) {
            throw new LetsPingError("LetsPing Error: Raw Zod schema detected. You must convert it to JSON Schema (e.g. using 'zod-to-json-schema') before passing it to the SDK.");
        }

        const otel = await getOtel();
        let span: any = null;
        if (otel && otel.trace) {
            const tracer = otel.trace.getTracer("letsping-sdk");
            span = tracer.startSpan(`letsping.ask`, {
                attributes: {
                    "letsping.service": options.service,
                    "letsping.action": options.action,
                    "letsping.priority": options.priority || "medium",
                }
            });
        }

        const traceId = options.trace_id;
        const parentId = options.parent_request_id;

        // Do not mutate caller payload; attach tracing metadata under a reserved key.
        const basePayload = options.payload || {};
        const metaKey = "_lp_meta";
        const existingMeta = (basePayload as any)[metaKey] || {};
        const enrichedPayload = {
            ...basePayload,
            [metaKey]: {
                ...existingMeta,
                ...(traceId ? { trace_id: traceId } : {}),
                ...(parentId ? { parent_request_id: parentId } : {}),
            },
        };

        try {
            const res = await this.request<{ id: string, uploadUrl?: string, dek?: string }>("POST", "/ingest", {
                service: options.service,
                action: options.action,
                payload: this._encrypt(enrichedPayload),
                priority: options.priority || "medium",
                schema: options.schema,
                metadata: { role: options.role, sdk: "node", trace_id: traceId, parent_request_id: parentId }
            });

            const { id, uploadUrl, dek } = res;

            if (uploadUrl && options.state_snapshot) {
                try {
                    const { data, contentType } = this._prepareStateUpload(options.state_snapshot, dek);
                    const putRes = await fetch(uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Type": contentType },
                        body: Buffer.isBuffer(data) ? (data as any) : JSON.stringify(data)
                    });
                    if (!putRes.ok) {
                        console.warn("LetsPing: Failed to upload state_snapshot to storage", await putRes.text());
                    }
                } catch (e: any) {
                    console.warn("LetsPing: Exception uploading state_snapshot", e.message);
                }
            }

            if (span) span.setAttribute("letsping.request_id", id);

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

                        if (span) {
                            span.setAttribute("letsping.status", finalStatus);
                            if (check.actor_id) span.setAttribute("letsping.actor_id", check.actor_id);
                            span.end();
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
        } catch (error: any) {
            if (span) {
                span.recordException(error);
                span.setStatus({ code: otel.SpanStatusCode.ERROR });
                span.end();
            }
            throw error;
        }
    }

    async defer(options: RequestOptions): Promise<{ id: string }> {
        const otel = await getOtel();
        let span: any = null;
        if (otel && otel.trace) {
            const tracer = otel.trace.getTracer("letsping-sdk");
            span = tracer.startSpan(`letsping.defer`, {
                attributes: {
                    "letsping.service": options.service,
                    "letsping.action": options.action,
                    "letsping.priority": options.priority || "medium",
                }
            });
        }

        const traceId = options.trace_id;
        const parentId = options.parent_request_id;
        const basePayload = options.payload || {};
        const metaKey = "_lp_meta";
        const existingMeta = (basePayload as any)[metaKey] || {};
        const enrichedPayload = {
            ...basePayload,
            [metaKey]: {
                ...existingMeta,
                ...(traceId ? { trace_id: traceId } : {}),
                ...(parentId ? { parent_request_id: parentId } : {}),
            },
        };

        try {
            const res = await this.request<{ id: string, uploadUrl?: string, dek?: string }>("POST", "/ingest", {
                service: options.service,
                action: options.action,
                payload: this._encrypt(enrichedPayload),
                priority: options.priority || "medium",
                schema: options.schema,
                metadata: { role: options.role, sdk: "node", trace_id: traceId, parent_request_id: parentId },
            });
            if (res.uploadUrl && options.state_snapshot) {
                try {
                    const { data, contentType } = this._prepareStateUpload(options.state_snapshot, res.dek);
                    const putRes = await fetch(res.uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Type": contentType },
                        body: Buffer.isBuffer(data) ? (data as any) : JSON.stringify(data)
                    });
                    if (!putRes.ok) {
                        console.warn("LetsPing: Failed to upload state_snapshot to storage", await putRes.text());
                    }
                } catch (e: any) {
                    console.warn("LetsPing: Exception uploading state_snapshot", e.message);
                }
            }

            if (span) {
                span.setAttribute("letsping.request_id", res.id);
                span.end();
            }
            return { id: res.id };
        } catch (error: any) {
            if (span) {
                span.recordException(error);
                span.setStatus({ code: otel.SpanStatusCode.ERROR });
                span.end();
            }
            throw error;
        }
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

    async webhookHandler(
        payloadStr: string,
        signatureHeader: string,
        webhookSecret: string
    ): Promise<{ id: string; event: string; data: Decision; state_snapshot?: Record<string, any> }> {
        const sigParts = signatureHeader.split(",").map(p => p.split("="));
        const sigMap = Object.fromEntries(sigParts);

        const rawTs = sigMap["t"];
        const rawSig = sigMap["v1"];
        if (!rawTs || !rawSig) {
            throw new LetsPingError("LetsPing Error: Missing webhook signature fields", 401);
        }

        const ts = Number(rawTs);
        if (!Number.isFinite(ts)) {
            throw new LetsPingError("LetsPing Error: Invalid webhook timestamp", 401);
        }

        const now = Date.now();
        const skewMs = Math.abs(now - ts);
        const maxSkewMs = 5 * 60 * 1000; // 5 minutes
        if (skewMs > maxSkewMs) {
            throw new LetsPingError("LetsPing Error: Webhook replay window exceeded", 401);
        }

        const expected = createHmac("sha256", webhookSecret).update(payloadStr).digest("hex");
        if (rawSig !== expected) {
            throw new LetsPingError("LetsPing Error: Invalid webhook signature", 401);
        }

        const payload = JSON.parse(payloadStr);
        const data = payload.data;
        let state_snapshot = undefined;

        if (data && data.state_download_url) {
            try {
                const res = await fetch(data.state_download_url);
                if (res.ok) {
                    const contentType = res.headers.get("content-type") || "";
                    if (contentType.includes("application/octet-stream")) {
                        const fallbackDek = data.dek;
                        if (fallbackDek) {
                            const buffer = Buffer.from(await res.arrayBuffer());
                            const keyBuf = Buffer.from(fallbackDek, "base64");
                            const iv = buffer.subarray(0, 12);
                            const ctFull = buffer.subarray(12);

                            const authTag = ctFull.subarray(ctFull.length - 16);
                            const ct = ctFull.subarray(0, ctFull.length - 16);

                            const decipher = createDecipheriv("aes-256-gcm", keyBuf, iv);
                            decipher.setAuthTag(authTag);
                            const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
                            state_snapshot = JSON.parse(plain.toString("utf8"));
                        } else {
                            console.warn("LetsPing: Missing fallback DEK to decrypt octet-stream storage file");
                        }
                    } else {
                        const encState = await res.json();
                        state_snapshot = this._decrypt(encState);
                    }
                } else {
                    console.warn("LetsPing: Could not fetch state_snapshot from storage", await res.text());
                }
            } catch (e: any) {
                console.warn("LetsPing: Exception downloading state_snapshot from webhook url", e.message);
            }
        }

        return {
            id: payload.id,
            event: payload.event,
            data,
            state_snapshot
        };
    }
}

export { computeDiff };