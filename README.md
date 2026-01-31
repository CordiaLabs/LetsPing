# LetsPing

<div align="center">

[![PyPI version](https://badge.fury.io/py/letsping.svg)](https://badge.fury.io/py/letsping)
[![npm version](https://badge.fury.io/js/@letsping%2Fsdk.svg)](https://badge.fury.io/js/@letsping%2Fsdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Human-in-the-loop infrastructure for autonomous agents.**

[Website](https://letsping.co) • [Documentation](https://docs.letsping.co)

</div>

---

## What is LetsPing?

LetsPing provides durable state management for agent workflows that require human oversight. It lets you pause execution, send a request to a human approver (with optional payload editing), and resume only after a decision is made.

It is framework-agnostic and works with LangChain, CrewAI, AutoGen, Vercel AI SDK, LangGraph.js, or plain scripts.

## Features

- Durable waits: Execution pauses without polling or idle compute.
- Secure approval dashboard: Approvers see only the request payload.
- Payload editing: Humans can modify JSON before approval.
- Immutable audit logs.

## Ecosystem

| Package          | Description                          | Source                                      |
|------------------|--------------------------------------|---------------------------------------------|
| Python SDK       | LangChain, CrewAI, AutoGen           | [`packages/python`](packages/python)        |
| Node.js SDK      | Vercel AI SDK, LangGraph.js          | [`packages/sdk`](packages/sdk)              |
| CLI              | Local debugging and tunnels          | [`packages/cli`](packages/cli)              |
| OpenClaw Skill   | Prompt-based HITL for OpenClaw agents | [CordiaLabs/openclaw-skill](https://github.com/CordiaLabs/openclaw-skill) |

## Installation

### Python
```bash
pip install letsping
```

### Node.js
```bash
npm install @letsping/sdk
```

## Quick Start

### Python
```python
import os
from letsping import LetsPing

lp = LetsPing(api_key=os.getenv("LETSPING_API_KEY"))

payload = {
    "amount": 5000,
    "currency": "USD",
    "recipient": "0x123..."
}

print("Requesting approval...")
result = lp.ask(
    channel="finance",
    payload=payload,
    description="High-value transfer"
)

if result.status == "APPROVED":
    execute_transfer(result.payload)  # May have been edited
else:
    print("Rejected")
```

### Node.js
```ts
import { LetsPing } from "@letsping/sdk";

const lp = new LetsPing({ apiKey: process.env.LETSPING_API_KEY });

const payload = {
  amount: 5000,
  currency: "USD",
  recipient: "0x123..."
};

console.log("Requesting approval...");
const result = await lp.ask({
  channel: "finance",
  payload,
  description: "High-value transfer"
});

if (result.status === "APPROVED") {
  executeTransfer(result.payload);  // May have been edited
} else {
  console.log("Rejected");
}
```

## Feedback & Issues

LetsPing is in public beta. The core platform is closed-source; the SDKs are open.

File bugs, request features, or discuss usage in Issues.

## Security

For vulnerabilities, email security@letsping.co (do not open public issues).