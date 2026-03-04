import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

let SDK_VERSION = "0.3.3";
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
     * Optional environment label so the ledger can group actions across runtimes.
     * Example values: "cloudflare", "vercel-ai", "langgraph", "mcp", "bare-metal".
     */
    environment?: string;

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

/** Status of a request returned by GET /status/:id. Use with defer() + getRequestStatus() for polling without reading the raw HTTP API. */
export interface RequestStatus {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    payload?: any;
    patched_payload?: any;
    resolved_at?: string | null;
    actor_id?: string | null;
}

/** Base URL for error documentation. Errors may include a link to a specific anchor. */
export const LETSPING_DOCS_BASE = "https://letsping.co/docs";

/** Known error codes for programmatic handling and doc links. */
export type LetsPingErrorCode =
    | "LETSPING_401_AUTH"
    | "LETSPING_402_QUOTA"
    | "LETSPING_403_FORBIDDEN"
    | "LETSPING_404_NOT_FOUND"
    | "LETSPING_429_RATE_LIMIT"
    | "LETSPING_TIMEOUT"
    | "LETSPING_NETWORK"
    | "LETSPING_WEBHOOK_INVALID"
    | string;

export class LetsPingError extends Error {
    /** HTTP status when the error came from the API (e.g. 402, 429). */
    public readonly status?: number;
    /** Stable code for handling (e.g. LETSPING_402_QUOTA). Use for branching or logging. */
    public readonly code?: LetsPingErrorCode;
    /** Link to the relevant doc section. Present when code is set. */
    public readonly documentationUrl?: string;

    constructor(
        message: string,
        status?: number,
        code?: LetsPingErrorCode,
        documentationUrl?: string
    ) {
        super(message);
        this.name = "LetsPingError";
        this.status = status;
        this.code = code ?? (status ? statusToCode(status) : undefined);
        this.documentationUrl = documentationUrl ?? (this.code ? codeToDocUrl(this.code) : undefined);
    }
}

function statusToCode(status: number): LetsPingErrorCode {
    switch (status) {
        case 401: return "LETSPING_401_AUTH";
        case 402: return "LETSPING_402_QUOTA";
        case 403: return "LETSPING_403_FORBIDDEN";
        case 404: return "LETSPING_404_NOT_FOUND";
        case 429: return "LETSPING_429_RATE_LIMIT";
        case 408: return "LETSPING_TIMEOUT";
        default: return status >= 500 ? "LETSPING_NETWORK" : (`LETSPING_${status}` as LetsPingErrorCode);
    }
}

function codeToDocUrl(code: LetsPingErrorCode): string {
    const anchor: Record<string, string> = {
        LETSPING_401_AUTH: "#auth",
        LETSPING_402_QUOTA: "#billing",
        LETSPING_403_FORBIDDEN: "#auth",
        LETSPING_404_NOT_FOUND: "#requests",
        LETSPING_429_RATE_LIMIT: "#rate-limits",
        LETSPING_TIMEOUT: "#timeouts",
        LETSPING_NETWORK: "#errors",
        LETSPING_WEBHOOK_INVALID: "#webhooks",
    };
    return `${LETSPING_DOCS_BASE}${anchor[code] ?? ""}`;
}

function parseApiError(responseStatus: number, body: { message?: string; error?: string; code?: string }): { message: string; code: LetsPingErrorCode; documentationUrl: string } {
    const message = body?.message ?? body?.error ?? `API Error [${responseStatus}]`;
    const code = (body?.code as LetsPingErrorCode) ?? statusToCode(responseStatus);
    return { message, code, documentationUrl: codeToDocUrl(code) };
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

export function verifyEscrow(event: EscrowEnvelope, secret: string): boolean {
    if (!event.escrow || !event.escrow.handoff_signature) return false;
    const base = {
        id: event.id,
        event: event.event,
        data: event.data,
        upstream_agent_id: event.escrow.upstream_agent_id,
        downstream_agent_id: event.escrow.downstream_agent_id,
        x402_mandate: event.escrow.x402_mandate ?? null,
        ap2_mandate: event.escrow.ap2_mandate ?? null,
    };
    const expected = createHmac("sha256", secret).update(JSON.stringify(base)).digest("hex");
    return expected === event.escrow.handoff_signature;
}

export interface AgentCallPayload {
    project_id: string;
    service: string;
    action: string;
    payload: any;
}

export function signAgentCall(agentId: string, secret: string, call: AgentCallPayload): {
    agent_id: string;
    agent_signature: string;
} {
    const canonical = JSON.stringify({
        project_id: call.project_id,
        service: call.service,
        action: call.action,
        payload: call.payload,
    });
    const signature = createHmac("sha256", secret).update(canonical).digest("hex");
    return {
        agent_id: agentId,
        agent_signature: signature,
    };
}

export function signIngestBody(
    agentId: string,
    secret: string,
    body: {
        project_id: string;
        service: string;
        action: string;
        payload: any;
    }
): {
    project_id: string;
    service: string;
    action: string;
    payload: any;
    agent_id: string;
    agent_signature: string;
} {
    const { agent_id, agent_signature } = signAgentCall(agentId, secret, {
        project_id: body.project_id,
        service: body.service,
        action: body.action,
        payload: body.payload,
    });
    return {
        ...body,
        agent_id,
        agent_signature,
    };
}

/** Credentials returned by createAgentWorkspace. Use api_key for Bearer auth and ingestWithAgentSignature for signed ingest. */
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

function delayMs(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
    url: string,
    init: RequestInit,
    retry: Required<RetryOptions>
): Promise<Response> {
    const maxAttempts = Math.max(1, retry.maxAttempts);
    let lastRes: Response | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = await fetch(url, init);
        lastRes = res;
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === maxAttempts) return res;
        const delay = Math.min(
            retry.initialDelayMs * Math.pow(1.5, attempt - 1) + Math.random() * 200,
            retry.maxDelayMs
        );
        await delayMs(delay);
    }
    return lastRes!;
}

/**
 * Request a signup token, redeem it to create a workspace, and register one agent. Returns credentials so the agent can call ingestWithAgentSignature.
 * Rate limits apply (see letsping.co/docs). Throws on 4xx/5xx or if self-serve signup is disabled.
 * @param options.baseUrl - App root URL (e.g. https://letsping.co). Defaults to LETSPING_BASE_URL or https://letsping.co.
 * @param options.retry - Optional retry for transient failures (429, 5xx). Default no retry.
 */
export async function createAgentWorkspace(options?: {
    baseUrl?: string;
    retry?: RetryOptions;
}): Promise<AgentWorkspaceCredentials> {
    const baseUrl = (options?.baseUrl ?? process.env.LETSPING_BASE_URL ?? "https://letsping.co").replace(/\/+$/, "");
    const r = options?.retry ?? {};
    const retry: Required<RetryOptions> = {
        maxAttempts: r.maxAttempts ?? 1,
        initialDelayMs: r.initialDelayMs ?? 1000,
        maxDelayMs: r.maxDelayMs ?? 10000,
    };

    const tokenRes = await fetchWithRetry(
        `${baseUrl}/api/agent-signup/request-token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        },
        retry
    );
    if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({})) as { error?: string; code?: string };
        const { message, code, documentationUrl } = parseApiError(tokenRes.status, err);
        throw new LetsPingError(message, tokenRes.status, code, documentationUrl);
    }
    const { token } = (await tokenRes.json()) as { token: string };
    if (!token) {
        throw new LetsPingError("LetsPing Error: No token in request-token response");
    }

    const redeemRes = await fetchWithRetry(
        `${baseUrl}/api/agent-signup`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        },
        retry
    );
    if (!redeemRes.ok) {
        const err = await redeemRes.json().catch(() => ({})) as { error?: string; message?: string };
        const { message, code, documentationUrl } = parseApiError(redeemRes.status, err);
        throw new LetsPingError(message, redeemRes.status, code, documentationUrl);
    }
    const redeem = (await redeemRes.json()) as {
        project_id: string;
        api_key: string;
        ingest_url: string;
        agents_register_url: string;
        org_id?: string;
        docs_url?: string;
    };
    if (!redeem.api_key || !redeem.agents_register_url) {
        throw new LetsPingError("LetsPing Error: Invalid redeem response (missing api_key or agents_register_url)");
    }

    const registerRes = await fetchWithRetry(
        redeem.agents_register_url,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${redeem.api_key}`,
                "Content-Type": "application/json",
            },
            body: "{}",
        },
        retry
    );
    if (!registerRes.ok) {
        const err = await registerRes.json().catch(() => ({})) as { error?: string };
        const { message, code, documentationUrl } = parseApiError(registerRes.status, err);
        throw new LetsPingError(message, registerRes.status, code, documentationUrl);
    }
    const reg = (await registerRes.json()) as { agent_id: string; agent_secret: string };
    if (!reg.agent_id || !reg.agent_secret) {
        throw new LetsPingError("LetsPing Error: Invalid register response (missing agent_id or agent_secret)");
    }

    return {
        project_id: redeem.project_id,
        api_key: redeem.api_key,
        ingest_url: redeem.ingest_url,
        agents_register_url: redeem.agents_register_url,
        agent_id: reg.agent_id,
        agent_secret: reg.agent_secret,
        org_id: redeem.org_id,
        docs_url: redeem.docs_url,
    };
}

/** Options for ingestWithAgentSignature. */
export interface IngestWithAgentSignatureOptions {
    projectId: string;
    ingestUrl: string;
    apiKey: string;
    /** Optional retry for transient failures (429, 5xx). */
    retry?: RetryOptions;
}

/** Ingest payload: service, action, and payload. */
export interface IngestPayload {
    service: string;
    action: string;
    payload: Record<string, any>;
}

/**
 * Build a signed ingest body and POST it to the ingest URL with Bearer apiKey. Returns the JSON response; throws on non-2xx.
 * Use this so the agent quickstart does not require hand-rolled HMAC or curl. See also: signIngestBody.
 * Optional options.retry for transient 429/5xx.
 */
export async function ingestWithAgentSignature(
    agentId: string,
    agentSecret: string,
    payload: IngestPayload,
    options: IngestWithAgentSignatureOptions
): Promise<Record<string, any>> {
    const body = signIngestBody(agentId, agentSecret, {
        project_id: options.projectId,
        service: payload.service,
        action: payload.action,
        payload: payload.payload ?? {},
    });
    const r = options.retry ?? {};
    const retry: Required<RetryOptions> = {
        maxAttempts: r.maxAttempts ?? 1,
        initialDelayMs: r.initialDelayMs ?? 1000,
        maxDelayMs: r.maxDelayMs ?? 10000,
    };
    const res = await fetchWithRetry(
        options.ingestUrl,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${options.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        },
        retry
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
        const { message, code, documentationUrl } = parseApiError(res.status, data as { error?: string });
        throw new LetsPingError(message, res.status, code, documentationUrl);
    }
    return data;
}

export function verifyAgentSignature(
    agentId: string,
    secret: string,
    call: AgentCallPayload,
    signature: string
): boolean {
    const { agent_signature } = signAgentCall(agentId, secret, call);
    return agent_signature === signature;
}

export function chainHandoff(previous: EscrowEnvelope, nextData: {
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
} {
    const base = {
        id: previous.id,
        event: previous.event,
        data: nextData.payload,
        upstream_agent_id: nextData.upstream_agent_id,
        downstream_agent_id: nextData.downstream_agent_id,
    };
    const handoff_signature = createHmac("sha256", secret).update(JSON.stringify(base)).digest("hex");
    return {
        payload: nextData.payload,
        escrow: {
            mode: "handoff",
            upstream_agent_id: nextData.upstream_agent_id,
            downstream_agent_id: nextData.downstream_agent_id,
            handoff_signature,
        },
    };
}

/** Optional retry config for ingest and status calls. Disabled when maxAttempts is 1 or omitted. */
export interface RetryOptions {
    /** Max attempts per request (default 1 = no retry). Try 3 for transient resilience. */
    maxAttempts?: number;
    /** Initial delay in ms before first retry (default 1000). */
    initialDelayMs?: number;
    /** Cap on delay between retries in ms (default 10000). */
    maxDelayMs?: number;
}

export class LetsPing {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly encryptionKey: string | null;
    private readonly retry: Required<RetryOptions>;

    constructor(apiKey?: string, options?: { baseUrl?: string; encryptionKey?: string; retry?: RetryOptions }) {
        const key = apiKey || process.env.LETSPING_API_KEY;
        if (!key) throw new Error("LetsPing: API Key is required. Pass it to the constructor or set LETSPING_API_KEY env var.");

        this.apiKey = key;
        this.baseUrl = options?.baseUrl || "https://letsping.co/api";
        this.encryptionKey = options?.encryptionKey
            ?? process.env.LETSPING_ENCRYPTION_KEY
            ?? null;
        const r = options?.retry ?? {};
        this.retry = {
            maxAttempts: r.maxAttempts ?? 1,
            initialDelayMs: r.initialDelayMs ?? 1000,
            maxDelayMs: r.maxDelayMs ?? 10000,
        };
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

    /**
     * Send a request and block until a human approves or rejects it (or timeout). Use for HITL steps in your agent.
     * @param options - service, action, payload; optional priority, schema, state_snapshot, timeoutMs, role
     * @returns Decision with status APPROVED | REJECTED | APPROVED_WITH_MODIFICATIONS and payload (or patched_payload)
     * @throws LetsPingError with code/documentationUrl on API or network errors, or LETSPING_TIMEOUT if no decision in time
     * @see https://letsping.co/docs#ask
     */
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
        const environment = options.environment || process.env.LETSPING_ENVIRONMENT;

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
                ...(environment ? { environment } : {}),
            },
        };

        try {
            const res = await this.request<{ id: string, uploadUrl?: string, dek?: string }>("POST", "/ingest", {
                service: options.service,
                action: options.action,
                payload: this._encrypt(enrichedPayload),
                priority: options.priority || "medium",
                schema: options.schema,
                metadata: {
                    role: options.role,
                    sdk: "node",
                    trace_id: traceId,
                    parent_request_id: parentId,
                    ...(environment ? { environment } : {}),
                }
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

        throw new LetsPingError(
            `Request ${id} timed out waiting for approval.`,
            undefined,
            "LETSPING_TIMEOUT",
            `${LETSPING_DOCS_BASE}#timeouts`
        );
    } catch (error: any) {
            if (span) {
                span.recordException(error);
                span.setStatus({ code: otel.SpanStatusCode.ERROR });
                span.end();
            }
            throw error;
        }
    }

    /**
     * Fetch the current status of a request by id. Use after defer() to poll until status is APPROVED or REJECTED without calling the raw HTTP API.
     * @param id - Request id returned from defer()
     * @returns RequestStatus with status PENDING | APPROVED | REJECTED, payload, resolved_at, actor_id
     * @see https://letsping.co/docs#requests
     */
    async getRequestStatus(id: string): Promise<RequestStatus> {
        const raw = await this.request<RequestStatus>("GET", `/status/${id}`);
        return raw;
    }

    /**
     * Send a request and return immediately with the request id. Poll with getRequestStatus(id) or waitForDecision(id) until resolved.
     * Use for async flows (e.g. webhook rehydration) where you do not want to block in-process.
     * @param options - service, action, payload; optional priority, schema, state_snapshot, role
     * @returns { id } - use id with getRequestStatus(id) or waitForDecision(id)
     * @see https://letsping.co/docs#defer
     */
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
        const environment = options.environment || process.env.LETSPING_ENVIRONMENT;
        const basePayload = options.payload || {};
        const metaKey = "_lp_meta";
        const existingMeta = (basePayload as any)[metaKey] || {};
        const enrichedPayload = {
            ...basePayload,
            [metaKey]: {
                ...existingMeta,
                ...(traceId ? { trace_id: traceId } : {}),
                ...(parentId ? { parent_request_id: parentId } : {}),
                ...(environment ? { environment } : {}),
            },
        };

        try {
            const res = await this.request<{ id: string, uploadUrl?: string, dek?: string }>("POST", "/ingest", {
                service: options.service,
                action: options.action,
                payload: this._encrypt(enrichedPayload),
                priority: options.priority || "medium",
                schema: options.schema,
                metadata: {
                    role: options.role,
                    sdk: "node",
                    trace_id: traceId,
                    parent_request_id: parentId,
                    ...(environment ? { environment } : {}),
                },
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

        const maxAttempts = Math.max(1, this.retry.maxAttempts);
        let lastError: LetsPingError | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}${path}`, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorBody: { message?: string; error?: string; code?: string } = {};
                    try {
                        errorBody = JSON.parse(errorText);
                    } catch { }
                    const { message, code, documentationUrl } = parseApiError(response.status, errorBody);
                    lastError = new LetsPingError(message, response.status, code, documentationUrl);
                    const retryable = response.status === 429 || response.status >= 500;
                    if (retryable && attempt < maxAttempts) {
                        await this._delay(attempt);
                        continue;
                    }
                    throw lastError;
                }

                return await response.json() as T;
            } catch (e: any) {
                if (e instanceof LetsPingError) {
                    lastError = e;
                    const retryable = e.status === 429 || (e.status != null && e.status >= 500);
                    if (retryable && attempt < maxAttempts) {
                        await this._delay(attempt);
                        continue;
                    }
                    throw e;
                }
                lastError = new LetsPingError(
                    `Network Error: ${e?.message ?? "Unknown"}`,
                    undefined,
                    "LETSPING_NETWORK",
                    `${LETSPING_DOCS_BASE}#errors`
                );
                if (attempt < maxAttempts) {
                    await this._delay(attempt);
                    continue;
                }
                throw lastError;
            }
        }

        throw lastError ?? new LetsPingError("Request failed", undefined, "LETSPING_NETWORK", `${LETSPING_DOCS_BASE}#errors`);
    }

    private _delay(attempt: number): Promise<void> {
        const delay = Math.min(
            this.retry.initialDelayMs * Math.pow(1.5, attempt - 1) + Math.random() * 200,
            this.retry.maxDelayMs
        );
        return new Promise(r => setTimeout(r, delay));
    }

    /**
     * Poll for a decision on a request created with defer(). Blocks until status is APPROVED/REJECTED or timeout.
     * @param id - request id from defer()
     * @param options - originalPayload (fallback if payload not in response), timeoutMs (default 24h)
     * @returns Decision same shape as ask()
     * @see https://letsping.co/docs#requests
     */
    async waitForDecision(
        id: string,
        options?: { originalPayload?: Record<string, any>; timeoutMs?: number }
    ): Promise<Decision> {
        const basePayload = options?.originalPayload || {};
        const timeout = options?.timeoutMs || 24 * 60 * 60 * 1000;
        const start = Date.now();
        let delay = 1000;
        const maxDelay = 10000;

        while (Date.now() - start < timeout) {
            try {
                const check = await this.request<any>("GET", `/status/${id}`);

                if (check.status === "APPROVED" || check.status === "REJECTED") {
                    const decryptedPayload = this._decrypt(check.payload) ?? basePayload;
                    const decryptedPatched = check.patched_payload ? this._decrypt(check.patched_payload) : undefined;

                    let diff_summary;
                    let finalStatus: Decision["status"] = check.status;
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

        throw new LetsPingError(
            `Request ${id} timed out waiting for approval.`,
            undefined,
            "LETSPING_TIMEOUT",
            `${LETSPING_DOCS_BASE}#timeouts`
        );
    }

    /**
     * Build a callable tool (e.g. for LangChain) that runs ask(service, action, payload) and returns a result string.
     * @param service - LetsPing service name
     * @param action - action name
     * @param priority - optional priority (default medium)
     * @returns Async function(context) => string; context can be JSON string or object
     * @see https://letsping.co/docs#tool
     */
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

    /**
     * Validate and parse an incoming LetsPing webhook body. Verifies signature and optionally fetches/decrypts state_snapshot.
     * @param payloadStr - raw request body (e.g. await req.text())
     * @param signatureHeader - x-letsping-signature header
     * @param webhookSecret - secret from dashboard → Settings → Webhooks
     * @returns { id, event, data, state_snapshot } for resuming your workflow
     * @throws LetsPingError with code LETSPING_WEBHOOK_INVALID and documentationUrl on invalid signature or replay
     * @see https://letsping.co/docs#webhooks
     */
    async webhookHandler(
        payloadStr: string,
        signatureHeader: string,
        webhookSecret: string
    ): Promise<{ id: string; event: string; data: Decision; state_snapshot?: Record<string, any> }> {
        const sigParts = signatureHeader.split(",").map(p => p.split("="));
        const sigMap = Object.fromEntries(sigParts);

        const rawTs = sigMap["t"];
        const rawSig = sigMap["v1"];
        const docUrl = `${LETSPING_DOCS_BASE}#webhooks`;
        if (!rawTs || !rawSig) {
            throw new LetsPingError("LetsPing Error: Missing webhook signature fields", 401, "LETSPING_WEBHOOK_INVALID", docUrl);
        }

        const ts = Number(rawTs);
        if (!Number.isFinite(ts)) {
            throw new LetsPingError("LetsPing Error: Invalid webhook timestamp", 401, "LETSPING_WEBHOOK_INVALID", docUrl);
        }

        const now = Date.now();
        const skewMs = Math.abs(now - ts);
        const maxSkewMs = 5 * 60 * 1000; // 5 minutes
        if (skewMs > maxSkewMs) {
            throw new LetsPingError("LetsPing Error: Webhook replay window exceeded", 401, "LETSPING_WEBHOOK_INVALID", docUrl);
        }

        const expected = createHmac("sha256", webhookSecret).update(payloadStr).digest("hex");
        if (rawSig !== expected) {
            throw new LetsPingError("LetsPing Error: Invalid webhook signature", 401, "LETSPING_WEBHOOK_INVALID", docUrl);
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