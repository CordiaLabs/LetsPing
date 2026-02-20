# @letsping/sdk

The official Node.js/TypeScript SDK for [LetsPing](https://letsping.co).

LetsPing is the Human-in-the-Loop control plane for autonomous agents — the durable state layer that pauses execution before sensitive actions, persists encrypted agent state, and resumes only after explicit human approval (or rejection/correction).

## Requirements

- Node.js 18+
- TypeScript 5+ (recommended)

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
  priority: "medium"
});

console.log(`Approval request queued → ${id}`);
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