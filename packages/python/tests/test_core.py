import pytest
import respx
from httpx import Response
from letsping import LetsPing, ApprovalRejectedError, DEFAULT_BASE_URL

MOCK_API_KEY = "lp_test_mock_key"

@pytest.fixture
def client():
    return LetsPing(api_key=MOCK_API_KEY)

@respx.mock
def test_ask_approval_flow(client):
    """Verifies the standard approval lifecycle (Ingest -> Pending -> Approved)."""
    ingest_route = respx.post(f"{DEFAULT_BASE_URL}/ingest")
    ingest_route.mock(return_value=Response(200, json={"id": "req_123"}))
    
    status_route = respx.get(f"{DEFAULT_BASE_URL}/status/req_123")
    status_route.side_effect = [
        Response(200, json={"status": "PENDING"}),
        Response(200, json={
            "status": "APPROVED",
            "payload": {"amount": 100},
            "patched_payload": {"amount": 100},
            "metadata": {"actor_id": "user_1", "resolved_at": "2024-01-01"}
        })
    ]

    result = client.ask("test-service", "test-action", {"amount": 100}, timeout=2)

    assert result["status"] == "APPROVED"
    assert result["metadata"]["actor_id"] == "user_1"
    assert ingest_route.called
    assert status_route.call_count == 2

@respx.mock
def test_rejection_error(client):
    """Verifies that human rejection raises the specific exception."""
    respx.post(f"{DEFAULT_BASE_URL}/ingest").mock(return_value=Response(200, json={"id": "req_999"}))
    
    respx.get(f"{DEFAULT_BASE_URL}/status/req_999").mock(return_value=Response(200, json={
        "status": "REJECTED",
        "reason": "Risk score too high",
        "metadata": {}
    }))

    with pytest.raises(ApprovalRejectedError) as exc:
        client.ask("test", "test", {}, timeout=2)
    
    assert "Risk score too high" in str(exc.value)

@respx.mock
@pytest.mark.asyncio
async def test_async_flow():
    """Verifies the async/await implementation works correctly."""
    client = LetsPing(api_key=MOCK_API_KEY)
    
    respx.post(f"{DEFAULT_BASE_URL}/ingest").mock(return_value=Response(200, json={"id": "req_async"}))
    respx.get(f"{DEFAULT_BASE_URL}/status/req_async").mock(return_value=Response(200, json={
        "status": "APPROVED", 
        "payload": {},
        "metadata": {}
    }))

    result = await client.aask("async-service", "run", {})
    assert result["status"] == "APPROVED"