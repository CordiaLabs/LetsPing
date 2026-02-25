# @letsping/sdk

The official Node.js/TypeScript SDK for [LetsPing](https://letsping.co).

LetsPing is a behavioral firewall and Human-in-the-Loop (HITL) infrastructure layer for Agentic AI. It provides mathematically secure state-parking (Cryo-Sleep) and execution governance for autonomous agents built on frameworks like LangGraph, Vercel AI SDK, and custom architectures.

### Features
- **The Behavioral Shield:** Silently profiles your agent's execution paths via Markov Chains. Automatically intercepts 0-probability reasoning anomalies (hallucinations/prompt injections).
- **Cryo-Sleep State Parking:** Pauses execution and securely uploads massive agent states directly to storage using Signed URLs, entirely bypassing serverless timeouts and webhook payload limits.
- **Smart-Accept Drift Adaptation:** Approval decisions mathematically alter the baseline. Old unused reasoning paths decay automatically via Exponential Moving Average (EMA).

## Requirements
- Node.js 18+
- TypeScript 5+ (recommended)
- (Optional) `@langchain/langgraph` and `@langchain/core` for state persistence

## Installation

```bash
npm install @letsping/sdk
```

## Usage

### Blocking Request (`ask`)

Execution suspends until the request is approved, rejected, or times out.

```typescript
import { LetsPing } from "@letsping/sdk";

const lp = new LetsPing(process.env.LETSPING_API_KEY!);

async function processRefund(userId: string, amount: number) {
  try {
    const decision = await lp.ask({
      service: "billing-service",
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

### Webhook Rehydration (Framework Agnostic)
LetsPing does **not** magically inject state back into your framework natively. You must handle the webhook and rehydrate your specific framework manually.

```typescript
// Example Webhook Route Handler
if (body.status === "APPROVED") {
    let hydratedState = null;
    if (body.state_download_url) {
        const res = await fetch(body.state_download_url);
        hydratedState = lp._decrypt(await res.json());
    }
    // Manually push `hydratedState` back into your LangGraph/Vercel thread
}
```

### LangGraph Integration (Persisted State)

LetsPing provides a `LetsPingCheckpointer` for LangGraph JS/TS that automatically encrypts and parks your agent's state in Cryo-Sleep storage.

```typescript
import { StateGraph } from "@langchain/langgraph";
import { LetsPing } from "@letsping/sdk";

// Import the checkpointer from the specific integration path
import { LetsPingCheckpointer } from "@letsping/sdk/integrations/langgraph";

const lp = new LetsPing(process.env.LETSPING_API_KEY!);
const checkpointer = new LetsPingCheckpointer(lp);
```

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
| `timeoutMs`  | `number`                        | Max wait time (default: 86_400_000 ms = 24 hours)                           |

### `lp.defer(options): Promise<{ id: string }>`

Fire-and-forget: queues request and returns request ID immediately. Same options shape as `ask`.

### Decision Type

```typescript
interface Decision {
  status: "APPROVED" | "REJECTED";
  payload: Record<string, any>;          // Original payload sent by agent
  patched_payload?: Record<string, any>; // Human-edited values (if modified)
  metadata: {
    actor_id: string;                    // ID/email of the approving/rejecting human
    resolved_at: string;                 // ISO 8601 timestamp
  };
}
```

For full documentation, request schema examples, error codes, and dashboard integration see:  
https://letsping.co/docs#sdk

Deploy agents with confidence.