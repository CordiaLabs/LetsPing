# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-02-28

### Added
- Unified agent ledger semantics documented with `environment` vocabulary and example queries for cross environment analysis.
- One hour evaluation path in README.

### Changed
- Docs updated to highlight the opinionated approval helper paths and Cloudflare receipts.

## [0.3.0] - 2026-02-28

### Added
- First-run experience: single-command demo path and dashboard "Run this" flow for time to first approval.
- Framework-specific examples: LangGraph + Next.js, Vercel AI SDK + tools, Python + FastAPI (clone, set key, run).
- Agent path in SDK: helpers for agent workspace creation and signed ingest so agent quickstart does not require raw curl/HMAC.
- Ergonomic improvements: structured error codes with documentation links, JSDoc "See also" on key methods, optional retries and status helper for defer flows.
- README "Guides" section: HITL in 2 min, LangGraph, Vercel AI SDK, agent-only, webhooks (links to docs and examples).

### Changed
- Compatibility: Node.js 18+ (unchanged). All packages aligned to 0.3.0 for coordinated release; public CordiaLabs/LetsPing repo synced with examples and READMEs.

## [0.2.1] - 2025-02-28

### Changed
- Package metadata: repository, homepage, license, keywords, engines (Node 18+).

## [0.2.0] - 2025-02

### Added
- LangGraph integration (`@letsping/sdk/integrations/langgraph`) for state persistence and HITL.
- Agent identity and escrow helpers: `signAgentCall`, `verifyEscrow`, `chainHandoff`.
- Cryo-Sleep state parking with signed URLs.
- Behavioral firewall (Markov-based anomaly detection) and smart-accept drift.

### Changed
- Improved TypeScript types and exports.
