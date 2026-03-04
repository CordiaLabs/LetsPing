# @letsping/sdk

The official Node.js and TypeScript SDK for [LetsPing](https://letsping.co).

LetsPing is a behavioral firewall and human in the loop control plane for agents. It pauses high risk actions, lets a human approve, reject, or patch the payload, then resumes execution.

## One file quickstart (dangerous action, dashboard link, 3 outcomes)

This is the smallest end to end pattern. It submits a request, prints the dashboard link, then shows what the agent sees on APPROVED, REJECTED, and APPROVED_WITH_MODIFICATIONS.

```ts
import { LetsPing } from "@letsping/sdk";

const lp = new LetsPing(process.env.LETSPING_API_KEY!);
const { id } = await lp.defer({ service: "db-agent", action: "sql", payload: { query: "DROP TABLE users" } });
console.log("Approve or reject in dashboard:", `https://letsping.co/requests/${id}`);
const d = await lp.waitForDecision(id, { originalPayload: { query: "DROP TABLE users" } });
if (d.status === "REJECTED") console.log({ status: "REJECTED", message: "Do not proceed." });
else if (d.status === "APPROVED_WITH_MODIFICATIONS") console.log({ status: d.status, diff_summary: d.diff_summary, executed_payload: d.patched_payload });
else console.log({ status: "APPROVED", executed_payload: d.payload });
```

## Why not just build this myself

- **Anomaly detection**: LetsPing learns baselines and can intercept anomalies before they execute, not just request approvals.
- **Escrow and x402**: agent to agent settlement and funding flows are handled as part of the control plane so your agent does not need to embed payments logic.
- **Receipts**: decisions and cryptographic receipts are emitted in machine readable shapes for audits, incident review, and billing.

## Observability surfaces

- **OpenTelemetry spans**: the SDK emits `letsping.ask` and `letsping.defer` spans when `@opentelemetry/api` is present. Attributes include `letsping.service`, `letsping.action`, `letsping.priority`, and `letsping.request_id` when available.
- **Cloudflare Tail Workers receipts**: use `@letsping/adapters/cloudflare` to publish structured receipts into `diagnostics_channel` so they appear in Tail Workers.

**What you get with this SDK:** One client that connects your agent to the LetsPing control plane, including a hosted dashboard for approvals, state parking for long running flows, and audit trails.

## When you should not use this

- You need a full audit log of every token or message. This SDK is designed for tool level approvals, not full conversation logging.
- You only need basic API key checks or RBAC. Use your existing auth layer; LetsPing is for high risk tool boundaries and approvals.
- You want to replace your own identity provider. LetsPing does not replace your auth system. It sits in front of tools and services.

## One hour evaluation path

If you want to feel the value in under one meeting:

1. Clone the `examples/vercel-ai-tools` or your minimal Node demo.
2. Point it at a staging Stripe or database if you want to see a real side effect.
3. Run three steps:
   - Trigger a dangerous action like `delete_account` or `DROP TABLE users`.
   - Reject it once in the LetsPing dashboard.
   - Approve it once with a patched payload.
4. Look in three places:
   - The decision in the LetsPing dashboard.
   - The log output or Cloudflare Tail Worker receipt.
   - The diff between requested and executed payload.

### Advanced features
- **Behavioral profiling:** Optional Markov based profiling of your agent's execution paths. Detects reasoning anomalies and can flag requests before tools run.
- **State parking:** Pauses execution and securely uploads large agent state to storage using signed URLs, so long running flows are not blocked by timeouts.
- **Baseline adaptation:** Approval decisions update the baseline over time. Old unused paths decay automatically via exponential moving average.
- **Agent identity and escrow helpers:** Optional HMAC helpers (`signAgentCall`, `verifyEscrow`, `chainHandoff`) for linking agent calls and handoffs to LetsPing requests.

## Requirements

- **Compatibility:** Node.js 18+. TypeScript 5+ recommended.
- (Optional) `@langchain/langgraph` and `@langchain/core` for state persistence

## Installation

```bash
npm install @letsping/sdk
```

## Usage

### Minimal drop-in example

The fastest way to see your first approval in the dashboard:

```ts
import { LetsPing } from "@letsping/sdk";

const apiKey = process.env.LETSPING_API_KEY;
if (!apiKey) throw new Error("Missing LETSPING_API_KEY env var.");

const lp = new LetsPing(apiKey);

const decision = await lp.ask({
  service: "billing-agent",
  action: "refund_user",
  payload: { user_id: "u_123", amount: 100 },
});
```

Every example in this README follows the same pattern: **either pass the key explicitly or rely on `LETSPING_API_KEY` via env**.

### Agent path (self-serve + signed ingest)

For headless agents that get their own workspace and send signed ingest without a human:

- **`createAgentWorkspace(options?)`** — Request token → redeem → register in one call. Returns `{ project_id, api_key, ingest_url, agent_id, agent_secret }` so the agent gets its own workspace. Rate limits apply; see [agent quickstart](https://letsping.co/agent/quickstart).
- **`ingestWithAgentSignature(agentId, agentSecret, payload, options)`** — POST a signed ingest with built-in retries and no hand-rolled HMAC. Errors are thrown as `LetsPingError` with `code` (e.g. `LETSPING_402_QUOTA`, `LETSPING_429_RATE_LIMIT`) and `documentationUrl` for branching or user-facing links.

### Blocking Request (`ask`)

Execution suspends until the request is approved, rejected, or times out.

```typescript
import { LetsPing } from "@letsping/sdk";

const lp = new LetsPing(process.env.LETSPING_API_KEY!);

async function processRefund(userId: string, amount: number) {
  try {
    const decision = await lp.ask({
      service: "billing-agent",
      action: "refund_user",
      priority: "high",
      payload: { userId, amount },

      // Optional: JSON Schema to render an editable form in the dashboard
      // (If using Zod: convert via zodToJsonSchema(mySchema))
      schema: {
        type: "object",
        properties: {
          amount: { type: "number", maximum: 5000 }
        },
        required: ["amount"]
      },

      // Optional override (default: 24 hours)
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    });

    if (decision.status === "APPROVED") {
      // Prefer patched_payload if human edited values
      const data = decision.patched_payload ?? decision.payload;
      await stripe.refunds.create({
        charge: data.userId,
        amount: Math.round(data.amount * 100),
      });
      console.log("Refund executed");
    } else {
      console.log(`Refund ${decision.status.toLowerCase()} by operator`);
    }
  } catch (error) {
    console.error("Approval failed or timed out:", error);
  }
}
```

### Non-Blocking Request (`defer`)

Queues the request immediately and returns; ideal for serverless or event-driven flows.

```typescript
const { id } = await lp.defer({
  service: "notification-agent",
  action: "send_email",
  payload: {
    to: "user@example.com",
    subject: "Your invoice is ready",
    amount: 249.99
  },
  priority: "medium",
  // Optional: Pass the full LangGraph/Vercel state dict.
  // It will be encrypted client-side and uploaded directly to S3.
  state_snapshot: agentState
});

console.log(`Approval request queued → ${id}`);
```

### Webhook Rehydration (Next.js Example)

When you pass `state_snapshot` to `ask` / `defer`, the SDK:

- Encrypts the snapshot with either `LETSPING_ENCRYPTION_KEY` or a one‑time DEK.
- Uploads it directly to your storage bucket using a signed URL.
- Includes a `state_download_url` (and DEK) in subsequent webhooks.

You can use the built‑in `webhookHandler` to validate and hydrate webhooks in a Next.js App Router route:

```typescript
// Example Next.js App Router route
import { NextRequest, NextResponse } from "next/server";
import { LetsPing } from "@letsping/sdk";

const lp = new LetsPing();
const WEBHOOK_SECRET = process.env.LETSPING_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-letsping-signature") || "";

  try {
    const { id, event, data, state_snapshot } = await lp.webhookHandler(
      rawBody,
      signature,
      WEBHOOK_SECRET
    );

    // At this point:
    // - `data` contains the decision payload (status, payload, patched_payload, metadata, etc.)
    // - `state_snapshot` contains your decrypted agent state, if Cryo-Sleep was used.

    await handleDecision({ id, event, data, state_snapshot });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("LetsPing webhook error:", err);
    return NextResponse.json({ error: "invalid webhook" }, { status: 400 });
  }
}

async function handleDecision(args: {
  id: string;
  event: string;
  data: any;
  state_snapshot?: Record<string, any>;
}) {
  // Example: resume a workflow run or LangGraph thread using `state_snapshot`
}
```

This pattern works similarly for Express/Fastify — call `lp.webhookHandler(rawBody, signature, secret)`, then resume your framework using the provided `state_snapshot`.

### LangGraph Integration (Persisted State)

LetsPing provides a `LetsPingCheckpointer` for LangGraph JS/TS under `@letsping/sdk/integrations/langgraph`.  
In v0.2 this checkpointer persists checkpoints **remotely** via the LetsPing control plane — encrypted alongside your existing Cryo‑Sleep state in Supabase Storage. Threads can survive process restarts without you wiring your own database.

```typescript
import { StateGraph } from "@langchain/langgraph";
import { LetsPing } from "@letsping/sdk";
import { LetsPingCheckpointer } from "@letsping/sdk/integrations/langgraph";

const lp = new LetsPing(process.env.LETSPING_API_KEY!);
const checkpointer = new LetsPingCheckpointer(lp);

const builder = new StateGraph<any /* your state type */>({});
const graph = builder.compile({ checkpointer });
```

#### Auto‑resuming a thread after approval (webhook + checkpointer)

Because checkpoints are stored remotely, you can resume a LangGraph thread from any worker once a human clicks Approve. A minimal Next.js webhook + auto‑resume flow looks like:

```ts
// Example Next.js App Router route for LangGraph auto-resume
import { NextRequest, NextResponse } from "next/server";
import { LetsPing } from "@letsping/sdk";
import { StateGraph } from "@langchain/langgraph";
import { LetsPingCheckpointer } from "@letsping/sdk/integrations/langgraph";
import { graphBuilder } from "@/lib/langgraph"; // your app's graph definition

const lp = new LetsPing(process.env.LETSPING_API_KEY!);
const checkpointer = new LetsPingCheckpointer(lp);
const graph = graphBuilder.compile({ checkpointer });

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-letsping-signature") || "";

  const event = await lp.webhookHandler(raw, sig, process.env.LETSPING_WEBHOOK_SECRET!);
  const { data, state_snapshot } = event;

  // You decide how to encode the thread id into your state snapshot.
  const threadId = state_snapshot?.thread_id as string | undefined;
  if (!threadId) return NextResponse.json({ ok: false, error: "missing_thread_id" }, { status: 400 });

  // Resume the graph from the latest remote checkpoint.
  await graph.invoke(state_snapshot.input, {
    configurable: { thread_id: threadId },
  });

  return NextResponse.json({ ok: true });
}
```

In your agent runner, you simply include `thread_id` and `state_snapshot` when you first call LetsPing from inside a LangGraph node. The checkpointer and webhook then keep the thread resumable across restarts. If the human edited the payload in the dashboard, `data.patched_payload` (or `data.payload`) is available in the webhook payload — use your framework’s normal state-update or channel overwrite semantics to inject the approved payload into the resumed graph so the run sees the correct values.

## API Reference

### `new LetsPing(apiKey, options?)`

- `apiKey` (string) — **required** — Service Role or Project API key from LetsPing dashboard
- `options.baseUrl` (string) — optional — Override endpoint (self-hosted / staging)

### `lp.ask(options): Promise<Decision>`

Blocks until resolved (approve / reject / timeout).

| Property     | Type                            | Description                                                                 |
|--------------|---------------------------------|-----------------------------------------------------------------------------|
| `service`    | `string`                        | Service / module identifier (e.g. "billing", "compliance")                  |
| `action`     | `string`                        | Action name (e.g. "refund", "transfer_funds")                               |
| `payload`    | `Record<string, any>`           | Context passed to human operator (and returned in Decision)                 |
| `priority`   | `"low" \| "medium" \| "high" \| "critical"` | Routing priority in dashboard                                               |
| `schema`     | `object`                        | JSON Schema (draft 07) — generates editable form in dashboard               |
| `timeoutMs`  | `number`                        | Max wait time in **milliseconds** (default: 86_400_000 ms = 24 hours)      |

### `lp.defer(options): Promise<{ id: string }>`

Fire-and-forget: queues request and returns request ID immediately. Same options shape as `ask`.

### Decision Type

```typescript
interface Decision {
  status: "APPROVED" | "REJECTED" | "APPROVED_WITH_MODIFICATIONS";
  payload: Record<string, any>;          // Original payload sent by agent
  patched_payload?: Record<string, any>; // Human-edited values (if modified)
  diff_summary?: any;                    // Field-level diff between payload and patched_payload
  metadata?: {
    actor_id: string;                    // ID/email of the approving/rejecting human
    resolved_at: string;                 // ISO 8601 timestamp
    method?: string;                     // Optional resolution method (e.g. "dashboard")
  };
}
```

**Structured errors:** All API and network errors are thrown as `LetsPingError` with optional `status`, `code` (e.g. `LETSPING_402_QUOTA`, `LETSPING_429_RATE_LIMIT`, `LETSPING_TIMEOUT`), and `documentationUrl` so you can branch or log and link users to the right doc. See https://letsping.co/docs#errors.

**Optional retries:** Pass `retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10000 }` in the constructor to enable exponential backoff for ingest and status calls (429 and 5xx are retried).

**Status helper:** Use `lp.getRequestStatus(id)` after `defer()` to poll for request status without calling the raw HTTP API. See https://letsping.co/docs#requests.

For full documentation, request schema examples, and dashboard integration see:  
https://letsping.co/docs#sdk

### Agent-to-Agent Escrow (optional)

For multi-agent systems that want cryptographic guarantees around handoffs, the SDK exposes:
- `signAgentCall(agentId, secret, call)` to attach `agent_id` and `agent_signature` to `/ingest` calls.
- `signIngestBody(agentId, secret, body)` to take an existing ingest body (`{ project_id, service, action, payload }`) and return it with `agent_id` and `agent_signature` attached.
- `verifyEscrow(event, secret)` to validate LetsPing escrow webhooks.
- `chainHandoff(previous, nextData, secret)` to safely construct downstream handoffs tied to the original request id.

See the one-page spec at `/docs/agent-escrow-spec` in the LetsPing web app for the exact wire format and interoperability rules.

Deploy agents with confidence.

## 2-Minute Demo (Node/TypeScript)

You can feel the full LetsPing loop (intercept → approve → resume) in under 2 minutes.

```ts
// demo.ts
import { LetsPing } from "@letsping/sdk";

async function main() {
  const apiKey = process.env.LETSPING_API_KEY;
  if (!apiKey) {
    console.error("Missing LETSPING_API_KEY env var.");
    process.exit(1);
  }

  const lp = new LetsPing(apiKey);

  console.log("Sending demo approval request to LetsPing…");
  const decision = await lp.ask({
    service: "demo-agent",
    action: "transfer_funds",
    priority: "high",
    payload: {
      amount: 500,
      currency: "USD",
      recipient: "acct_demo_123",
    },
  });

  if (decision.status === "REJECTED") {
    console.log("Demo request REJECTED by human. No action taken.");
  } else if (decision.status === "APPROVED_WITH_MODIFICATIONS") {
    console.log("APPROVED WITH MODIFICATIONS:");
    console.dir(decision.diff_summary, { depth: null });
  } else {
    console.log("APPROVED with original payload.");
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
```

Run:

```bash
export LETSPING_API_KEY="lp_live_..."
node demo.ts
```

Then open the LetsPing dashboard for your project, approve/reject the `demo-agent / transfer_funds` request, and watch the script resume.

If you’re using the local tunnel (`npx @letsping/cli dev`), you can also point the SDK at it during local development:

```ts
const lp = new LetsPing(process.env.LETSPING_API_KEY!, {
  baseUrl: "http://localhost:<port>/api",
});
```

All `ask` / `defer` calls made through that client will flow through your local tunnel into the LetsPing dashboard.

---

**Compatibility:** Node 18+, TypeScript 5+. Optional: `@langchain/langgraph`, `@langchain/core` for LangGraph integration.

**License:** MIT. Source: [CordiaLabs/LetsPing](https://github.com/CordiaLabs/LetsPing) (packages/sdk).