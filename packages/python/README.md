# LetsPing Python SDK

[![PyPI version](https://badge.fury.io/py/letsping.svg)](https://badge.fury.io/py/letsping)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Versions](https://img.shields.io/pypi/pyversions/letsping.svg)](https://pypi.org/project/letsping/)

The official state management infrastructure for Human-in-the-Loop (HITL) AI agents.

LetsPing is a behavioral firewall and governance layer. It provides mathematically secure state-parking (Cryo-Sleep) and execution governance for autonomous agents built on frameworks like LangGraph, CrewAI, and custom architectures.

### Features
- **The Behavioral Shield:** Silently profiles your agent's execution paths via Markov Chains. Automatically intercepts 0-probability reasoning anomalies (hallucinations/prompt injections).
- **Cryo-Sleep State Parking:** Pauses execution and securely uploads massive agent states directly to storage using Signed URLs, entirely bypassing serverless timeouts and webhook payload limits.
- **Smart-Accept Drift Adaptation:** Approval decisions mathematically alter the baseline. Old unused reasoning paths decay automatically via Exponential Moving Average (EMA).

## Installation

```bash
pip install letsping

```

## Configuration

Set your API key as an environment variable (recommended) or pass it directly.

```bash
export LETSPING_API_KEY="lp_live_..."

```

## Usage

### 1. The "Ask" Primitive (Blocking)

Use this when you want to pause a script until a human approves.

```python
from letsping import LetsPing

client = LetsPing()

# Pauses here for up to 24 hours (default)
decision = client.ask(
    service="payments-agent",
    action="transfer_funds",
    payload={
        "amount": 5000,
        "currency": "USD",
        "recipient": "acct_99"
    },
    priority="critical"
)

# Execution resumes only after approval
print(f"Transfer approved by {decision['metadata']['actor_id']}")

```

### 2. Async / Non-Blocking (FastAPI/LangGraph)

For high-concurrency environments or event loops.

```python
import asyncio
from letsping import LetsPing

async def main():
async def main():
    client = LetsPing()
    
    # Non-blocking wait, with massive state snapshot
    # The state is AES-GCM encrypted and direct-uploaded to S3, bypassing payloads
    decision = await client.aask(
        service="github-agent",
        action="merge_pr",
        payload={"pr_id": 42},
        timeout=3600, # 1 hour timeout
        state_snapshot=graph.get_state()
    )

asyncio.run(main())

```

### 3. LangChain / Agent Integration

LetsPing provides a compliant tool interface that can be injected directly into LLM agent toolkits (LangChain, CrewAI, etc). This allows the LLM to *decide* when to ask for help.

```python
from letsping import LetsPing

client = LetsPing()

tools = [
    # ... your other tools (search, calculator) ...
    
    # Inject the human as a tool
    client.tool(
        service="research-agent",
        action="review_draft",
        priority="high"
    )
]

```

## Error Handling

The SDK uses typed exceptions for control flow.

* `ApprovalRejectedError`: Raised when the human explicitly clicks "Reject".
* `TimeoutError`: Raised when the duration (default 24h) expires without a decision.
* `LetsPingError`: Base class for API or network failures.
