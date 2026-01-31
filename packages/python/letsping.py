import os
import time
import json
import logging
import asyncio
from typing import Optional, Dict, Any, Literal, TypedDict, Callable

import httpx

logger = logging.getLogger("letsping")

DEFAULT_BASE_URL = "https://letsping.co/api"
VERSION = "0.1.0"

Priority = Literal["low", "medium", "high", "critical"]
Status = Literal["APPROVED", "REJECTED", "PENDING"]

class Decision(TypedDict):
    status: Status
    payload: Dict[str, Any]
    patched_payload: Optional[Dict[str, Any]]
    metadata: Dict[str, Any]

class LetsPingError(Exception):
    """Base class for all LetsPing SDK errors."""
    pass

class AuthenticationError(LetsPingError):
    pass

class ApprovalRejectedError(LetsPingError):
    def __init__(self, reason: str):
        super().__init__(f"Request rejected: {reason}")
        self.reason = reason

class TimeoutError(LetsPingError):
    pass

class LetsPing:
    """
    The official state management client for Human-in-the-Loop AI agents.
    Thread-safe and async-native.
    """

    def __init__(
        self, 
        api_key: Optional[str] = None, 
        base_url: Optional[str] = None,
        timeout: float = 30.0
    ):
        self._api_key = api_key or os.getenv("LETSPING_API_KEY")
        if not self._api_key:
            raise ValueError("LetsPing API Key must be provided via arg or LETSPING_API_KEY env var.")
        
        self._base_url = (base_url or os.getenv("LETSPING_BASE_URL", DEFAULT_BASE_URL)).rstrip('/')
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"letsping-python/{VERSION}",
            "Accept": "application/json"
        }

    def ask(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium", 
        timeout: int = 86400
    ) -> Decision:
        """Blocking call: Pauses execution until a human decision is rendered."""
        request_id = self.defer(service, action, payload, priority)
        return self.wait(request_id, timeout=timeout)

    def defer(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium",
        callback_url: Optional[str] = None
    ) -> str:
        """Non-blocking: Registers the request and returns the Request ID immediately."""
        body = {
            "service": service,
            "action": action,
            "payload": payload,
            "priority": priority,
            "metadata": {"sdk": "python", "callback_url": callback_url} if callback_url else {"sdk": "python"}
        }
        
        with httpx.Client(base_url=self._base_url, headers=self._headers, timeout=self._timeout) as client:
            resp = self._handle_response(client.post("/ingest", json=body))
            return resp["id"]

    def wait(self, request_id: str, timeout: int = 86400) -> Decision:
        """Resumes waiting for an existing request ID."""
        start_time = time.time()
        attempt = 0
        
        with httpx.Client(base_url=self._base_url, headers=self._headers, timeout=self._timeout) as client:
            while time.time() - start_time < timeout:
                attempt += 1
                try:
                    resp = client.get(f"/status/{request_id}")
                    if resp.status_code == 200:
                        decision = resp.json()
                        if decision["status"] in ("APPROVED", "REJECTED"):
                            return self._parse_decision(decision)
                    elif resp.status_code not in (404, 429):
                        self._handle_response(resp)
                except (httpx.RequestError, json.JSONDecodeError) as e:
                    logger.warning(f"LetsPing polling transient error: {e}")

                sleep_time = min(1.0 * (1.5 ** attempt), 10.0)
                time.sleep(sleep_time)

        raise TimeoutError(f"Wait timed out after {timeout}s for request {request_id}")

    async def aask(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium", 
        timeout: int = 86400
    ) -> Decision:
        """Async non-blocking wait. Compatible with asyncio event loops."""
        request_id = await self.adefer(service, action, payload, priority)
        return await self.await_(request_id, timeout=timeout)

    async def adefer(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium"
    ) -> str:
        body = {
            "service": service,
            "action": action,
            "payload": payload,
            "priority": priority,
            "metadata": {"sdk": "python"}
        }
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers, timeout=self._timeout) as client:
            resp = await client.post("/ingest", json=body)
            data = self._handle_response(resp)
            return data["id"]

    async def await_(self, request_id: str, timeout: int = 86400) -> Decision:
        start_time = time.time()
        attempt = 0
        
        async with httpx.AsyncClient(base_url=self._base_url, headers=self._headers, timeout=self._timeout) as client:
            while time.time() - start_time < timeout:
                attempt += 1
                try:
                    resp = await client.get(f"/status/{request_id}")
                    if resp.status_code == 200:
                        decision = resp.json()
                        if decision["status"] in ("APPROVED", "REJECTED"):
                            return self._parse_decision(decision)
                except (httpx.RequestError, json.JSONDecodeError):
                    pass 

                sleep_time = min(1.0 * (1.5 ** attempt), 10.0)
                await asyncio.sleep(sleep_time)

        raise TimeoutError(f"Async wait timed out after {timeout}s for request {request_id}")

    def tool(self, service: str, action: str, priority: Priority = "medium") -> Callable:
        """Returns a callable 'Tool' compatible with LangChain/CrewAI."""
        def human_approval_tool(context: str) -> str:
            try:
                payload = json.loads(context)
            except json.JSONDecodeError:
                payload = {"raw_context": context}
            
            try:
                result = self.ask(service, action, payload, priority)
                return json.dumps(result["approved_payload"])
            except ApprovalRejectedError as e:
                return f"ACTION_REJECTED: {e.reason}"
            except Exception as e:
                return f"ERROR: {str(e)}"
                
        return human_approval_tool

    def _handle_response(self, response: httpx.Response) -> Dict[str, Any]:
        if response.status_code == 401 or response.status_code == 403:
            raise AuthenticationError("Invalid API Key or unauthorized access.")
        
        try:
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            error_msg = response.text
            try:
                error_data = response.json()
                error_msg = error_data.get("message", response.text)
            except:
                pass
            raise LetsPingError(f"API Error {response.status_code}: {error_msg}") from e

    def _parse_decision(self, data: Dict[str, Any]) -> Decision:
        status = data.get("status")
        if status == "REJECTED":
            raise ApprovalRejectedError(data.get("reason", "No reason provided"))
        
        return {
            "status": "APPROVED",
            "payload": data.get("payload", {}),
            "patched_payload": data.get("patched_payload"),
            "metadata": data.get("metadata", {})
        }