# @letsping/adapters

Adapters that wrap existing AI agent frameworks so tool calls go through LetsPing for approval and audit.

**Pick your framework** — one canonical example per stack. Each runs with **only `LETSPING_API_KEY`**; clone, set key, run.

| Stack | Example (clone-and-run) |
|-------|-------------------------|
| **LangGraph + Next.js** | [examples/langgraph-nextjs](https://github.com/CordiaLabs/LetsPing/tree/main/examples/langgraph-nextjs) |
| **Vercel AI SDK** | [examples/vercel-ai-tools](https://github.com/CordiaLabs/LetsPing/tree/main/examples/vercel-ai-tools) |
| **Python + FastAPI** | [examples/python-fastapi](https://github.com/CordiaLabs/LetsPing/tree/main/examples/python-fastapi) |
| **Cloudflare Agents** | See [Cloudflare adapter](#cloudflare-agents-integration) below |

This package provides typed wrappers around `@letsping/sdk` that integrate with:

- Vercel AI SDK (as `CoreTool`)
- LangChain / LangGraph (as `DynamicStructuredTool`)
- Cloudflare Agents (Durable Objects) with `keepAliveWhile` and Tail Worker observability

When a model invokes one of these tools, execution pauses until the request is approved or rejected in the LetsPing dashboard.

## Installation

```bash
npm install @letsping/adapters @letsping/sdk zod
```

## When you should not use this

- You only need a raw HTTP client. These adapters are for frameworks that already support tool plugins.
- You want to stream full conversation logs or prompts. The adapters focus on tool calls; they do not turn LetsPing into a general logging layer.
- You are not using LangGraph, Vercel AI SDK, LangChain, or Cloudflare Agents. In that case call `@letsping/sdk` directly instead.

## One function for all frameworks

Export: `@letsping/adapters/approval`

If you want one opinionated entry point that returns the right tool type for your framework, use `createApprovalTool`.

```ts
import { createApprovalTool } from "@letsping/adapters/approval";
import { z } from "zod";

const tool = createApprovalTool({
  kind: "vercel",
  name: "delete_account",
  description: "Delete a user account. Requires human approval.",
  schema: z.object({ user_id: z.string() }),
  apiKey: process.env.LETSPING_API_KEY!
});
```

## Vercel AI SDK adapter

Export: `@letsping/adapters/vercel`

```ts
import { createApprovalTool } from "@letsping/adapters/approval";
import { z } from "zod";

const deleteAccountTool = createApprovalTool({
  kind: "vercel",
  name: "delete_account",
  description: "Dangerous: permanently delete a user account.",
  apiKey: process.env.LETSPING_API_KEY!,
  schema: z.object({ user_id: z.string().describe("User id to delete") }),
});

const tools = {
  delete_account: deleteAccountTool,
};
```

The tool automatically suspends model generation until a decision is made in the LetsPing dashboard.

## LangChain and LangGraph adapter

Export: `@letsping/adapters/langchain`

```ts
import { createLetsPingTool } from "@letsping/adapters/langchain";
import { z } from "zod";

const approvalTool = createLetsPingTool({
  name: "sensitive_action",
  description: "Request human permission before proceeding with this operation.",
  apiKey: process.env.LETSPING_API_KEY!,
  schema: z.object({
    reason: z.string().min(10).describe("Explain why this step is required"),
    estimated_impact: z.enum(["low", "medium", "high"]).default("medium"),
  }),
});

// Example usage in LangGraph or classic LangChain
const agent = new AgentExecutor({
  tools: [approvalTool /*, other tools */],
  llm,
  // ...
});
```

**Tool progress (LangGraph streaming)**  
When using LangGraph with stream mode `"tools"`, the adapter yields a progress event as soon as the request is queued: `status: "intercepted_by_firewall"`, `reason`, `triage_url`, and `request_id`. Your client can read this from `stream.toolProgress` (e.g. `useStream` in React) to show "Waiting for admin approval" and a link to the LetsPing triage dashboard without blocking the stream.

## Cloudflare Agents adapter

Export: `@letsping/adapters/cloudflare`

For [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (v0.7.0+, Durable Objects):

### Copy paste into your Agent class

This is the minimum integration. It ensures the agent stays alive while waiting for a human and emits receipts into Tail Workers.

1. **keepAliveWhile()**: keeps the Durable Object alive during HITL and escrow waits. Without it, Cloudflare can evict idle Durable Objects after roughly 70 seconds.

2. **Tail Worker receipts**: events are published to `diagnostics_channel` on `agents:letsping_firewall`. In production, Tail Workers receive these in `diagnosticsChannelEvents`.

3. **MCP firewalling**: use `mcpToolCallToRequestOptions()` to turn MCP `tools/call` params into LetsPing `RequestOptions`, so you can approve MCP tool calls before forwarding to the MCP server.

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createApprovalTool } from "@letsping/adapters/approval";
import {
  mcpToolCallToRequestOptions,
} from "@letsping/adapters/cloudflare";
import { z } from "zod";

type Env = {
  LETSPING_API_KEY: string;
};

export class ChatAgent extends AIChatAgent<Env> {
  waitForMcpConnections = { timeout: 10_000 };

  async onChatMessage() {
    const apiKey = this.env.LETSPING_API_KEY;
    if (!apiKey) {
      return new Response("Missing LETSPING_API_KEY", { status: 500 });
    }

    const dangerousTool = createApprovalTool({
      kind: "cloudflare",
      defer: true,
      name: "run_sql",
      description: "Execute a SQL query. Requires human approval.",
      apiKey,
      schema: z.object({ query: z.string() }),
      cloudflare: { keepAliveWhile: this.keepAliveWhile.bind(this) },
      onIntercepted: ({ triage_url }) => {
        this.addMessage({
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Waiting for approval: ${triage_url}`,
            },
          ],
        });
      },
    });

    const result = await dangerousTool.execute({ query: "DROP TABLE users" });

    this.addMessage({
      role: "assistant",
      parts: [{ type: "text", text: JSON.stringify(result) }],
    });

    return this.toUIMessageStreamResponse();
  }
}

// MCP: intercept tools/call and send through LetsPing first
const requestOptions = mcpToolCallToRequestOptions(
  { name: "execute_sql", arguments: { query: "DROP TABLE users" } },
  { service: "mcp-db", priority: "high" }
);
const decision = await this.keepAliveWhile(() => lp.ask(requestOptions));
```

### MCP full example (waitForMcpConnections plus firewall proxy)

Cloudflare Agents SDK v0.7+ can wait for MCP tools to reconnect after hibernation. If your agent calls MCP tools, you can firewall every `tools/call` before forwarding it.

```ts
import { LetsPing } from "@letsping/sdk";
import { mcpToolCallToRequestOptions } from "@letsping/adapters/cloudflare/mcp";

export class MyAgent extends AIChatAgent<Env> {
  waitForMcpConnections = { timeout: 10_000 };

  async onChatMessage() {
    const lp = new LetsPing(this.env.LETSPING_API_KEY);
    const tools = await this.mcp.getAITools();

    // Example MCP call
    const mcpCall = { name: "execute_sql", arguments: { query: "DROP TABLE users" } };

    // Firewall MCP tool arguments before running the tool
    const opts = mcpToolCallToRequestOptions(mcpCall, { service: "mcp-db", priority: "critical" });
    const decision = await this.keepAliveWhile(() => lp.ask(opts));
    if (decision.status === "REJECTED") return new Response("Blocked by LetsPing", { status: 403 });

    const approved = decision.patched_payload ?? decision.payload;
    return tools.execute_sql(approved);
  }
}
```

### Tail Worker output (exact shape)

In your Tail Worker, each receipt appears in `diagnosticsChannelEvents`. This is what it looks like:

```js
export default {
  async tail(events) {
    for (const event of events) {
      for (const msg of event.diagnosticsChannelEvents || []) {
        if (msg.channel === "agents:letsping_firewall") {
          console.log(msg.timestamp, msg.channel, msg.message);
        }
      }
    }
  }
};
```

Example `msg.message` payloads:

```json
{ "type": "letsping:intercepted", "payload": { "request_id": "req_123", "service": "db-agent", "action": "sql", "triage_url": "https://letsping.co/requests/req_123" }, "timestamp": 0 }
```

```json
{ "type": "letsping:approved_with_modifications", "payload": { "request_id": "req_123", "diff_summary": { "changes": { "query": { "from": "DROP TABLE users", "to": "SELECT 1" } } } }, "timestamp": 0 }
```

```json
{ "type": "letsping:escrow_settled", "payload": { "transaction_hash": "0xabc", "amount": 5.0 }, "timestamp": 0 }
```

Optional subpaths:

- `@letsping/adapters/cloudflare/observability`: `emitIntercepted`, `emitApproved`, `emitRejected`, `emitEscrowSettled`, `emitError`, for custom Tail Worker receipts.
- `@letsping/adapters/cloudflare/mcp`: `mcpToolCallToRequestOptions`, `isMcpToolCallRequest`, MCP types.

## Peer Dependencies

Make sure the following compatible versions are installed in your project:

| Package                  | Minimum Version | Purpose                                 |
|--------------------------|------------------|-----------------------------------------|
| `zod`                    | `>= 3.0.0`      | Schema definition & validation          |
| `ai`                     | `>= 2.0.0`      | Vercel AI SDK (for `/vercel` adapter)   |
| `@langchain/core`        | `>= 0.1.0`      | LangChain core types & tools            |

## Notes

- The `apiKey` is passed per-tool. For most applications you will use the same key across tools.
- The `schema` (Zod) is used both for type safety and to generate an editable form in the LetsPing dashboard.
- If the human modifies values in the form, the resolved payload will contain the updated values (`patched_payload` in the LetsPing SDK response).
- **Cryo-Sleep / state snapshots**: To park large agent state alongside a tool invocation, use the underlying `@letsping/sdk` client with `state_snapshot` when calling `ask` / `defer` from within your handler logic. The SDK will encrypt and upload the snapshot via signed URL.
- **Rehydration**: These adapters handle the *execution pause* natively within standard framework constructs, but they do *not* automatically rehydrate the framework once the process exits. You must handle webhook delivery and instantiate your framework resumption logic manually (see the SDK README webhook examples for Next.js / FastAPI).

For full LetsPing API documentation, see: https://letsping.co/docs

**License:** MIT. Source: [CordiaLabs/LetsPing](https://github.com/CordiaLabs/LetsPing) (packages/adapters).