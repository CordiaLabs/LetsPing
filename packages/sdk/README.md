# @letsping/sdk

The official Node.js/TypeScript SDK for [LetsPing](https://letsping.co).

LetsPing is a behavioral firewall and Human-in-the-Loop (HITL) infrastructure layer for Agentic AI. It provides mathematically secure state-parking (Cryo-Sleep) and execution governance for autonomous agents built on frameworks like LangGraph, Vercel AI SDK, and custom architectures.

**What you get with this SDK:** One client that connects your agent to the full LetsPing stack: a hosted dashboard for triage and approvals, a Markov-based behavioral firewall that learns your graph and intercepts anomalies, Cryo-Sleep state parking so long-running flows survive serverless limits, and audit trails for compliance. Use LangGraph (or any runtime) for the graph; use LetsPing for the human layer and guardrails.

### Features
- **The Behavioral Shield:** Silently profiles your agent's execution paths via Markov Chains. Automatically intercepts 0-probability reasoning anomalies (hallucinations/prompt injections).
- **Cryo-Sleep State Parking:** Pauses execution and securely uploads massive agent states directly to storage using Signed URLs, entirely bypassing serverless timeouts and webhook payload limits.
- **Smart-Accept Drift Adaptation:** Approval decisions mathematically alter the baseline. Old unused reasoning paths decay automatically via Exponential Moving Average (EMA).
- **Agent Identity & Escrow Helpers:** Optional HMAC-based helpers (`signAgentCall`, `verifyEscrow`, `chainHandoff`) for cryptographically linking agent calls and handoffs to LetsPing requests.

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

- `createAgentWorkspace(options?)` to do request-token → redeem → register in one call. Returns `{ project_id, api_key, ingest_url, agent_id, agent_secret }` so the agent gets its own workspace without a human. Rate limits apply; see [agent quickstart](https://letsping.co/agent/quickstart).
- `ingestWithAgentSignature(agentId, agentSecret, payload, options)` to POST a signed ingest (no hand-rolled HMAC or curl). Options: `{ projectId, ingestUrl, apiKey }`.
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