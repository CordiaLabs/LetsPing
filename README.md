# LetsPing | The Human-in-the-Loop Protocol

[![npm version](https://img.shields.io/npm/v/@letsping/sdk.svg)](https://www.npmjs.com/package/@letsping/sdk)
[![PyPI version](https://img.shields.io/pypi/v/letsping.svg)](https://pypi.org/project/letsping/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **The Governance Layer for Agentic AI.**
> Add human approval, oversight, and cryptographically signed governance to any AI workflow with a single line of code.

LetsPing is a high-throughput infrastructure layer that allows AI agents to pause execution, persist state to a secure cloud control plane, and resume only after a human operator provides a decision. It bridges the gap between autonomous agentic capabilities and enterprise safety requirements.

---

## Key Features

### End-to-End Encryption (E2EE)
Privacy is non-negotiable. Sensitive agent data is encrypted using AES-256-GCM before leaving the agent's environment. Only your human operators hold the keys.

### Cryo-Sleep State Snapshots
Agents can "park" their entire behavioral state (snapshots) in the cloud while waiting for human review. Execution resumes seamlessly only after approval.

### Rich Patching (Structured Editor)
Agents make typos. Don't reject the whole run—**fix it in-flight.**
- **Native UI Forms:** If your agent sends a JSON Schema, LetsPing renders an auto-generated form.
- **Human Correction:** Edit the payload directly in the dashboard and approve the corrected state.

### Enterprise Role-Based Routing
Ensure the right person makes the decision. Routing is handled natively at the protocol level.
```python
# Route to specific organizational units or roles
letsping.ask(..., role="finance") # Pings the CFO/Treasury
letsping.ask(..., role="devops")  # Pings the On-Call Engineer
```

### Universal MCP Server
Connect any agentic environment (Claude Desktop, Cursor, LangChain) instantly via the Model Context Protocol.
```bash
npx @letsping/mcp
```

---

## Monorepo Structure

This repository is a monorepo containing the core components of the LetsPing control plane.

| Package | Status | Description |
| :--- | :--- | :--- |
| [`@letsping/sdk`](/packages/sdk) | `v0.1.6` | Core TypeScript/Node.js SDK with full type safety and E2EE. |
| [`letsping`](/packages/python) | `v0.1.9` | Core Python SDK with async-native support and E2EE. |
| [`@letsping/adapters`](/packages/adapters) | `v0.1.5` | Drop-in tools for Vercel AI SDK and LangGraph. |
| [`@letsping/mcp`](/packages/mcp) | `v0.1.5` | Standardized Model Context Protocol server. |
| [`@letsping/cli`](/packages/cli) | `v0.1.5` | Local development and administrative CLI. |
| `apps/web` | Internal | Next.js 15 Control Plane Dashboard and Ingestion API. |

---

## Architecture & Infrastructure

LetsPing is built on an event-driven, serverless-first architecture designed for resilience and low latency.

* **Next.js 15 App Router:** Unified API gateway and real-time dashboard.
* **QStash & Upstash Redis:** High-throughput asynchronous ingestion and hot-state management.
* **Supabase:** PostgreSQL persistence with Row-Level Security (RLS) for multi-tenant isolation.

### Infrastructure Stack

| Component | Service | Purpose |
| :--- | :--- | :--- |
| **Compute & Edge** | Vercel | API gateway and Dashboard hosting. |
| **Database** | Supabase | Multi-tenant PostgreSQL and Auth. |
| **Async Queuing** | QStash | Durable messaging for agentic state persistence. |
| **State Cache** | Upstash Redis | Real-time signaling and dashboard updates. |
| **Billing** | Stripe | Enterprise subscription and usage management. |

---

## Getting Started

### Prerequisites
* Node.js 20+
* `npm`
* A LetsPing API Key (obtainable from the [LetsPing Dashboard](https://letsping.co/settings))

### Quick Start
```bash
# Set your API key
export LETSPING_API_KEY="your_api_key_here"

# Run the MCP server instantly
npx @letsping/mcp
```

For SDK integration and advanced usage, see the [packages](/packages) directory.

---

## License

LetsPing is [MIT Licensed](LICENSE).

---
Maintained by **Cordia Labs**.
