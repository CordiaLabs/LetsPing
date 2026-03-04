# LetsPing Python SDK

[![PyPI version](https://badge.fury.io/py/letsping.svg)](https://badge.fury.io/py/letsping)
[![Python Versions](https://img.shields.io/pypi/pyversions/letsping.svg)](https://pypi.org/project/letsping/)

The official Python client for [LetsPing](https://letsping.co).

LetsPing is a behavioral firewall and human in the loop control plane for agents. It pauses high risk actions, lets a human approve, reject, or patch the payload, then resumes execution.

## One command quickstart

```bash
pip install letsping
python -m letsping.quickstart
```

This will send one dangerous action, show the LetsPing dashboard link, and print what the agent sees for APPROVED, REJECTED, and APPROVED_WITH_MODIFICATIONS.

## One file quickstart (dangerous action, dashboard link, 3 outcomes)

This is the smallest end to end pattern. It submits a request, prints the dashboard link, then shows what the agent sees on APPROVED, REJECTED, and APPROVED_WITH_MODIFICATIONS.

```python
import os
from letsping import LetsPing, ApprovalRejectedError

lp = LetsPing(api_key=os.environ["LETSPING_API_KEY"])
request_id = lp.defer(service="db-agent", action="sql", payload={"query": "DROP TABLE users"})
print("Approve or reject in dashboard:", f"https://letsping.co/requests/{request_id}")
try:
    d = lp.wait(request_id, timeout=3600)
    print({"status": d["status"], "executed_payload": d.get("patched_payload") or d["payload"], "diff_summary": d.get("diff_summary")})
except ApprovalRejectedError:
    print({"status": "REJECTED", "message": "Do not proceed."})
```

## Opinionated approval tool example

For LangGraph, CrewAI, and similar frameworks, use the opinionated helper so approval is just one tool in your list:

```python
from letsping import LetsPing

client = LetsPing()  # reads LETSPING_API_KEY from the environment

tools = [
    client.approval_tool(
        service="db-agent",
        action="run_sql",
        description="Dangerous: run a SQL query.",
    )
]
```

## Why not just build this myself

- **Anomaly detection**: LetsPing learns baselines and can intercept anomalies before they execute, not just request approvals.
- **Escrow and x402**: agent to agent settlement and funding flows are handled as part of the control plane so your agent does not need to embed payments logic.
- **Receipts**: decisions and cryptographic receipts are emitted in machine readable shapes for audits, incident review, and billing.

**What you get with this package:** One client that connects your agent to the LetsPing control plane, including a hosted dashboard for approvals, state parking for long running flows, and audit trails.

## When you should not use this

- You want full transcript storage or prompt logging. This client is meant for tool level approvals, not full conversation capture.
- You only need simple API authentication. Use your own auth and RBAC for that; LetsPing focuses on high risk tool boundaries.
- You need to replace your primary monitoring or SIEM. LetsPing emits events and receipts but does not replace those systems.

### Advanced features
- **Behavioral profiling:** Optional Markov based profiling of your agent's execution paths so you can detect anomalies, not just request approvals.
- **State parking:** Pauses execution and securely uploads large agent state to storage using signed URLs, so long running flows are not blocked by timeouts.
- **Baseline adaptation:** Approval decisions adjust the baseline over time. Old unused paths decay automatically via exponential moving average.

## Installation

```bash
pip install letsping

# Or with LangGraph support
pip install "letsping[langgraph]"
```

## Configuration

Set your API key as an environment variable (recommended) or pass it directly.

```bash
export LETSPING_API_KEY="lp_live_..."

```

## Usage

### Minimal drop in example

The fastest way to see your first approval in the dashboard:

```python
from letsping import LetsPing

client = LetsPing()  # reads LETSPING_API_KEY from the environment

decision = client.ask(
    service="billing-agent",
    action="refund_user",
    payload={"user_id": "u_123", "amount": 100},
)
```

All timeouts in the Python SDK are expressed in **seconds** (for example, `timeout=3600` = 1 hour).

### 1. The "Ask" Primitive (Blocking)

Use this when you want to pause a script until a human approves.

```python
from letsping import LetsPing

client = LetsPing()

# Pauses here for up to 24 hours (default, expressed in seconds)
decision = client.ask(
    service="billing-agent",
    action="refund_user",
    payload={"user_id": "u_123", "amount": 5000, "currency": "USD"},
    priority="critical"
)

# Execution resumes only after approval
print(f"Transfer approved by {decision['metadata']['actor_id']}")

```

### Quick 2-Minute Demo

You can feel the LetsPing loop (intercept → approve → resume) with a tiny script:

```python
# demo.py
import os
from letsping import LetsPing

def main() -> None:
    api_key = os.getenv("LETSPING_API_KEY")
    if not api_key:
        raise SystemExit("Missing LETSPING_API_KEY env var.")

    client = LetsPing(api_key=api_key)

    print("Sending demo approval request to LetsPing…")
    decision = client.ask(
        service="demo-agent",
        action="transfer_funds",
        payload={"amount": 500, "currency": "USD", "recipient": "acct_demo_123"},
        priority="high",
    )

    status = decision["status"]
    if status == "REJECTED":
        print("Demo request REJECTED by human. No action taken.")
    elif status == "APPROVED_WITH_MODIFICATIONS":
        print("APPROVED WITH MODIFICATIONS:")
        print(decision.get("diff_summary"))
    else:
        print("APPROVED with original payload.")

if __name__ == "__main__":
    main()
```

Run:

```bash
export LETSPING_API_KEY="lp_live_..."
python demo.py
```

Then open the LetsPing dashboard for your project, approve/reject the `demo-agent / transfer_funds` request, and watch the script resume.

### 2. Async / Non-Blocking (FastAPI/LangGraph)

For high-concurrency environments or event loops.

```python
import asyncio
from letsping import LetsPing

async def main():
    client = LetsPing()

    # Non-blocking wait, with massive state snapshot.
    # The state is AES-GCM encrypted and uploaded via signed URL (Cryo-Sleep).
    decision = await client.aask(
        service="github-agent",
        action="merge_pr",
        payload={"pr_id": 42},
        timeout=3600,  # 1 hour timeout
        state_snapshot=graph.get_state()
    )

asyncio.run(main())

```

### 3. LangChain and agent integration

LetsPing provides a compliant tool interface that can be injected directly into LLM agent toolkits (LangGraph, CrewAI, and others). The opinionated helper is `approval_tool`, which returns a single tool that matches common agent patterns.

```python
from letsping import LetsPing

client = LetsPing()

tools = [
    client.approval_tool(
        service="db-agent",
        action="run_sql",
        description="Dangerous: run a SQL query.",
    )
]

```

### 4. LangGraph Integration (Persisted State)

LetsPing provides a `LetsPingCheckpointer` for LangGraph under `letsping.integrations.langgraph`.

In v0.2 this checkpointer persists checkpoints **remotely** via the LetsPing control plane — encrypted and stored next to your existing Cryo‑Sleep state in Supabase Storage. Threads can survive worker restarts without you plumbing your own database.

```python
from langgraph.graph import StateGraph
from letsping import LetsPing
from letsping.integrations.langgraph import LetsPingCheckpointer

client = LetsPing()
checkpointer = LetsPingCheckpointer(client)

# Initialize the graph with the LetsPing checkpointer
builder = StateGraph(...)
graph = builder.compile(checkpointer=checkpointer)

# Now, every 'thread_id' state is checkpointed remotely and can be resumed across workers.

#### Auto‑resuming a thread after approval (webhook + checkpointer)

Because checkpoints are stored via the LetsPing control plane, you can resume a LangGraph thread from any worker once a human clicks Approve. A minimal FastAPI webhook + auto‑resume flow looks like:

```python
from fastapi import FastAPI, Request, HTTPException
from letsping import LetsPing
from letsping.integrations.langgraph import LetsPingCheckpointer
from langgraph.graph import StateGraph

from .graph import build_graph  # your app's graph definition

lp = LetsPing()
checkpointer = LetsPingCheckpointer(lp)
graph: StateGraph = build_graph(checkpointer=checkpointer)

app = FastAPI()
WEBHOOK_SECRET = "lp_whk_..."  # store securely

@app.post("/letsping/langgraph-webhook")
async def letsping_langgraph_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("x-letsping-signature", "")

    try:
        event = lp.webhook_handler(
            payload_str=raw_body.decode("utf-8"),
            signature_header=signature,
            webhook_secret=WEBHOOK_SECRET,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    data = event["data"]
    state_snapshot = event.get("state_snapshot") or {}

    # You decide how to encode the thread id into your snapshot.
    thread_id = state_snapshot.get("thread_id")
    if not thread_id:
        raise HTTPException(status_code=400, detail="missing thread_id in state_snapshot")

    # Resume the graph from the latest remote checkpoint for this thread.
    await graph.ainvoke(state_snapshot.get("input", {}), config={"configurable": {"thread_id": thread_id}})

    return {"ok": True}
```

In your LangGraph nodes, you include `thread_id` and pass a `state_snapshot` when you call LetsPing. The remote checkpointer + webhook keep the thread resumable even if the worker restarts.
```

### 5. FastAPI Webhook Rehydration (Cryo-Sleep)

When you pass `state_snapshot` to `ask` / `aask` or `defer` / `adefer`, the client:

- Encrypts the snapshot with either `LETSPING_ENCRYPTION_KEY` or a one‑time key.
- Uploads it to storage using a signed URL.
- Includes a `state_download_url` (and DEK) in the webhook payload.

You can use `webhook_handler` to validate and hydrate webhooks in FastAPI:

```python
from fastapi import FastAPI, Request, HTTPException
from letsping import LetsPing

app = FastAPI()
client = LetsPing()
WEBHOOK_SECRET = "lp_whk_..."  # store securely

@app.post("/letsping/webhook")
async def letsping_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("x-letsping-signature", "")

    try:
        event = client.webhook_handler(
            payload_str=raw_body.decode("utf-8"),
            signature_header=signature,
            webhook_secret=WEBHOOK_SECRET,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # event = {"id", "event", "data", "state_snapshot"}
    await handle_decision(event)
    return {"ok": True}

async def handle_decision(event: dict):
    # Use event["data"] (decision payload) and event["state_snapshot"]
    # to resume your workflow / LangGraph thread.
    ...
```

For async frameworks you can also use `awebhook_handler` with the same pattern.

### Agent path (self-serve + signed ingest)

For headless agents that get their own workspace and send signed ingest calls without a human in the loop:

- `create_agent_workspace(base_url=None)` — Request token → redeem → register in one call. Returns `project_id`, `api_key`, `ingest_url`, `agent_id`, `agent_secret`. Rate limits apply; see [agent quickstart](https://letsping.co/agent/quickstart).
- `ingest_with_agent_signature(agent_id, agent_secret, service, action, payload, project_id, ingest_url, api_key)` — POST a signed ingest (no hand-rolled HMAC or curl). Built-in retries on 429/5xx when using the full client.

All API and network errors are raised as `LetsPingError` with optional `status`, `code` (e.g. `LETSPING_402_QUOTA`, `LETSPING_429_RATE_LIMIT`, `LETSPING_TIMEOUT`), and `documentation_url` so you can branch or link users to the right doc.

```python
from letsping import create_agent_workspace, ingest_with_agent_signature

creds = create_agent_workspace()  # optional: base_url="https://letsping.co"
result = ingest_with_agent_signature(
    creds["agent_id"], creds["agent_secret"],
    service="my-svc", action="test", payload={},
    project_id=creds["project_id"], ingest_url=creds["ingest_url"], api_key=creds["api_key"],
)
print(result["id"])
```

## Error Handling

The SDK uses typed exceptions for control flow. All API and network errors are raised as `LetsPingError` with optional `status`, `code` (e.g. `LETSPING_402_QUOTA`, `LETSPING_429_RATE_LIMIT`, `LETSPING_TIMEOUT`), and `documentation_url` so you can branch or link users to the right doc (see https://letsping.co/docs#errors).

* `ApprovalRejectedError`: Raised when the human explicitly clicks "Reject".
* `TimeoutError`: Raised when the duration (default 24h) expires without a decision.
* `LetsPingError`: Base class for API or network failures; includes `code` and `documentation_url` when available.

**Status helper:** Use `client.get_request_status(request_id)` after `defer()` to poll for request status without calling the raw HTTP API. See https://letsping.co/docs#requests.

---

**Compatibility:** Python 3.8+. Optional: `letsping[langgraph]` for LangGraph integration.

**License:** MIT. Source: [CordiaLabs/LetsPing](https://github.com/CordiaLabs/LetsPing) (packages/python).