# @letsping/mcp

The official **Model Context Protocol (MCP)** server for LetsPing.

This package enables any MCP-compliant agent (Claude Desktop, Cursor, LangChain, etc.) to natively "Ask a Human" for approval or help.

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
- `service` (string): The name of your agent (e.g. "billing-bot").
- `action` (string): What you are trying to do (e.g. "refund-user").
- `payload` (object): The data needing review (e.g. `{ amount: 50, user_id: "123" }`).
- `priority` (string, optional): "low" | "medium" | "high" | "critical".
- `role` (string, optional): Who should approve this? (e.g. "finance", "devops").
- `timeout` (number, optional): Max wait time in ms.

## Development

1. Clone the repo.
2. Run `npm install`.
3. Run `npm run build`.
