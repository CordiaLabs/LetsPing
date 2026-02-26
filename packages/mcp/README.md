# @letsping/mcp

The official **Model Context Protocol (MCP)** server for LetsPing.

This package enables any MCP-compliant agent (Claude Desktop, Cursor, LangChain, etc.) to natively invoke the **Behavioral Shield**, parking the context and "Asking a Human" for approval or help before deploying destructive API changes on your machine.

## Usage

### Zero-Config (via npx)

You can run the server directly without installing it, as long as you have your API Key.

**Claude Desktop Config (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "letsping": {
      "command": "npx",
      "args": ["-y", "@letsping/mcp"],
      "env": {
        "LETSPING_API_KEY": "lp_sk_..."
      }
    }
  }
}
```

### Tools Provided

#### `ask_human`
Request approval or input from a human operator.

**Arguments:**
- `service` (string): The name of your agent (e.g. `"billing-bot"`).
- `action` (string): What you are trying to do (e.g. `"refund-user"`).
- `payload` (object): The data needing review (e.g. `{ "amount": 50, "user_id": "123" }`).
- `priority` (string, optional): `"low"` \| `"medium"` \| `"high"` \| `"critical"`. Defaults to `"medium"`.
- `role` (string, optional): Who should approve this? (e.g. `"finance"`, `"devops"`).
- `timeout` (number, optional): Max wait time in **milliseconds** (default ~24h).

**Return shape (content text JSON):**

```jsonc
// APPROVED, no modifications
{
  "status": "APPROVED",
  "executed_payload": { /* final payload */ }
}

// APPROVED, with human modifications
{
  "status": "APPROVED_WITH_MODIFICATIONS",
  "message": "The human reviewer authorized this action but modified your original payload. Please review the diff_summary to learn from this correction.",
  "diff_summary": { "changes": { /* field-level diff */ } },
  "original_payload": { /* as requested by the agent */ },
  "executed_payload": { /* what will actually run */ }
}

// REJECTED
{
  "status": "REJECTED",
  "message": "The human operator rejected this action. Do not proceed with the plan.",
  "metadata": { /* optional audit fields */ }
}
```

**How an MCP agent should behave:**

- Never proceed with the risky action if `status === "REJECTED"`.
- If `status === "APPROVED_WITH_MODIFICATIONS"`, prefer `executed_payload` over the original; optionally learn from `diff_summary`.
- If `status === "APPROVED"`, proceed using `executed_payload`.

## Development

1. Clone the repo.
2. Run `pnpm install`.
3. Run `pnpm build`.
