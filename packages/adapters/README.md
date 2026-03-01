# @letsping/adapters

Drop-in Human-in-the-Loop tool adapters for popular AI agent frameworks.

**Pick your framework** — one canonical example per stack. Each runs with **only `LETSPING_API_KEY`**; clone, set key, run.

| Stack | Example (clone-and-run) |
|-------|-------------------------|
| **LangGraph + Next.js** | [examples/langgraph-nextjs](https://github.com/CordiaLabs/LetsPing/tree/main/examples/langgraph-nextjs) |
| **Vercel AI SDK** | [examples/vercel-ai-tools](https://github.com/CordiaLabs/LetsPing/tree/main/examples/vercel-ai-tools) |
| **Python + FastAPI** | [examples/python-fastapi](https://github.com/CordiaLabs/LetsPing/tree/main/examples/python-fastapi) |

This package provides strictly-typed wrappers around `@letsping/sdk` that integrate seamlessly with:

- Vercel AI SDK (as `CoreTool`)
- LangChain / LangGraph (as `DynamicStructuredTool`)

When a model invokes one of these tools, execution pauses until the request is approved or rejected via the LetsPing dashboard.

## Installation

```bash
npm install @letsping/adapters @letsping/sdk zod
```

## Vercel AI SDK Integration

Export: `@letsping/adapters/vercel`

```ts
import { letsPing } from "@letsping/adapters/vercel";
import { z } from "zod";

const tools = {
  deployToProd: letsPing({
    name: "deploy_production",
    description: "Deploys the current codebase to production. Requires human approval.",
    apiKey: process.env.LETSPING_API_KEY!,
    // Schema controls the editable form presented to the human operator
    schema: z.object({
      version: z.string().describe("Git commit SHA or version tag"),
      canary: z.boolean().default(false).describe("Deploy as canary release"),
      force: z.boolean().optional().describe("Bypass additional safety checks"),
    }),
  }),
};
```

The tool automatically suspends model generation until a decision is made in the LetsPing dashboard.

## LangChain / LangGraph Integration

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