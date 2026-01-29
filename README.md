# LetsPing

<div align="center">

[![PyPI version](https://badge.fury.io/py/letsping.svg)](https://badge.fury.io/py/letsping)
[![npm version](https://badge.fury.io/js/@letsping%2Fsdk.svg)](https://badge.fury.io/js/@letsping%2Fsdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Twitter](https://img.shields.io/twitter/follow/letspingai?style=social)](https://twitter.com/letspingai)

**The Human-in-the-Loop Protocol for AI Agents.**

[Website](https://letsping.co) • [Documentation](https://letsping.co/docs)

</div>

---

## What is LetsPing?

LetsPing is a state management infrastructure designed to solve the **"Durable Wait"** problem for autonomous agents. It allows developers to pause agent execution, request human approval (or data modification), and resume execution only after the human interaction is resolved.

It is designed to be **framework agnostic**, working seamlessly with LangChain, AutoGPT, CrewAI, or raw Python/Node scripts.

## Features

- **⏸️ Durable Pauses:** Agents sleep while waiting. No polling, no burning compute.
- **🛡️ Secure Gateway:** Human approvers access a secure dashboard, never the raw terminal.
- **📝 Payload Hot-Patching:** Humans can fix hallucinations in JSON payloads before they execute.
- **🔍 Audit Trails:** Immutable logs of who approved what and when.

## Installation

### Python
```bash
pip install letsping

```

### Node.js

```bash
npm install @letsping/sdk

```

## Quick Start (Python)

```python
from letsping import LetsPing

# 1. Initialize the client
lp = LetsPing(api_key="lp_sk_...")

# 2. Define the sensitive payload
transfer_data = {
    "amount": 5000,
    "currency": "USD",
    "recipient": "unknown_wallet_0x123"
}

# 3. Request Approval (This blocks until the human clicks "Approve")
print("Requesting human review...")
result = lp.ask(
    channel="finance-approvals",
    payload=transfer_data,
    description="High value transaction detected."
)

if result.status == "APPROVED":
    # 4. Use the (potentially modified) payload
    final_data = result.payload
    execute_transfer(final_data)
else:
    print("Transfer rejected by operator.")

```

## Feedback & Issues

LetsPing is currently in **Public Beta**.

While the core platform is closed-source, these SDKs are open. We are not currently accepting Pull Requests for new features as we stabilize the API, but we strictly value your feedback on the Developer Experience (DX).

If you encounter a bug or have a feature request, please [Open an Issue](https://github.com/cordialabs/letsping/issues).

## Security

For security concerns, please email security@letsping.co. Do not open public issues for vulnerabilities.
