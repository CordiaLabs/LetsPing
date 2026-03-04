# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-02-28

### Added
- Cloudflare adapter (`@letsping/adapters/cloudflare`): Native integration for Cloudflare Agents SDK v0.7.0+.
  - `keepAliveWhile()`: Wraps `ask()` and `waitForDecision()` so the Durable Object stays alive during HITL and escrow waits (no eviction mid flight).
  - Tail Worker observability: publishes to `diagnostics_channel` (`agents:letsping_firewall`) so intercepts, approvals, rejections, and errors flow into Tail Workers.
  - MCP firewalling: `mcpToolCallToRequestOptions()` and `isMcpToolCallRequest()` to map MCP `tools/call` to LetsPing requests.
  - Subpaths: `@letsping/adapters/cloudflare/observability`, `@letsping/adapters/cloudflare/mcp`.

### Changed
- Vercel and Cloudflare documentation now recommend the opinionated `createApprovalTool` path for `delete_account` and `run_sql` style dangerous actions.

## [0.3.0] - 2026-02-28

### Changed
- Bump to 0.3.0 for coordinated LetsPing release. Requires `@letsping/sdk@0.3.0`.
- Compatibility: Node.js 18+.

## [0.2.1] - 2025-02

- Initial published adapters for Vercel AI SDK and LangChain.
