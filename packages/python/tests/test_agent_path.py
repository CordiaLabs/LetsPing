import json

import pytest

import letsping


def test_sign_agent_call_produces_stable_hmac():
    call = {
        "project_id": "proj1",
        "service": "svc",
        "action": "act",
        "payload": {"a": 1},
    }

    sig1 = letsping._sign_agent_call("agent-1", "secret-key", call)
    sig2 = letsping._sign_agent_call("agent-1", "secret-key", call)

    assert sig1["agent_id"] == "agent-1"
    assert sig1["agent_signature"] == sig2["agent_signature"]
    # Signature should change if payload changes
    sig3 = letsping._sign_agent_call("agent-1", "secret-key", {**call, "payload": {"a": 2}})
    assert sig3["agent_signature"] != sig1["agent_signature"]


def test_create_agent_workspace_uses_retries(monkeypatch):
    calls = []

    responses = [
        {"token": "tok-123"},
        {"api_key": "api-key", "agents_register_url": "https://x/register", "project_id": "proj1"},
        {"agent_id": "agent1", "agent_secret": "secret1"},
    ]

    def fake_request_with_retry(client, method, url, max_attempts=1, initial_delay=1.0, max_delay=10.0, **kwargs):
        idx = len(calls)
        calls.append(
            {
                "method": method,
                "url": url,
                "max_attempts": max_attempts,
                "json": json.loads(json.dumps(kwargs.get("json", {}))),
            }
        )

        class DummyResponse:
            def __init__(self, payload):
                self._payload = payload

            def json(self):
                return self._payload

        return DummyResponse(responses[idx])

    monkeypatch.setattr(letsping, "_request_with_retry", fake_request_with_retry)

    creds = letsping.create_agent_workspace(base_url="https://letsping.co", retries=2)

    assert creds["project_id"] == "proj1"
    assert creds["agent_id"] == "agent1"
    assert len(calls) == 3  # token, redeem, register
    # max_attempts should be 1 + retries
    assert all(c["max_attempts"] == 3 for c in calls)


def test_ingest_with_agent_signature_uses_retry_options(monkeypatch):
    calls = []

    def fake_request_with_retry(client, method, url, max_attempts=1, initial_delay=1.0, max_delay=10.0, **kwargs):
        calls.append(
            {
                "method": method,
                "url": url,
                "max_attempts": max_attempts,
                "headers": kwargs.get("headers", {}),
            }
        )

        class DummyResponse:
            def json(self):
                return {"ok": True}

        return DummyResponse()

    monkeypatch.setattr(letsping, "_request_with_retry", fake_request_with_retry)

    resp = letsping.ingest_with_agent_signature(
        agent_id="agent1",
        agent_secret="secret1",
        service="svc",
        action="act",
        payload={"x": 1},
        project_id="proj1",
        ingest_url="https://api.letsping.co/ingest",
        api_key="k",
        retries=2,
        initial_delay=0.1,
        max_delay=1.0,
    )

    assert resp == {"ok": True}
    assert len(calls) == 1
    call = calls[0]
    assert call["method"] == "POST"
    assert call["url"].endswith("/ingest")
    assert call["max_attempts"] == 3
    assert call["headers"]["Authorization"].startswith("Bearer ")

