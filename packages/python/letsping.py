import os
import time
import json
import logging
import asyncio
import random
import base64
from typing import Optional, Dict, Any, Literal, TypedDict, Callable
from importlib.metadata import version as _pkg_version, PackageNotFoundError

import httpx

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False



def _encrypt_payload(key_b64: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Encrypt a payload dict with AES-256-GCM. Returns an EncEnvelope dict."""
    if not _CRYPTO_AVAILABLE:
        raise ImportError(
            "Payload encryption requires the 'cryptography' package. "
            "Install it with: pip install cryptography"
        )
    key = base64.b64decode(key_b64)
    aesgcm = AESGCM(key)
    iv = os.urandom(12)
    plain = json.dumps(payload).encode("utf-8")
    ct = aesgcm.encrypt(iv, plain, None)  # includes 16-byte GCM auth tag
    return {
        "_lp_enc": True,
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(ct).decode(),
    }


def _decrypt_payload(key_b64: str, envelope: Dict[str, Any]) -> Dict[str, Any]:
    """Decrypt an EncEnvelope dict. Returns the original payload dict."""
    if not _CRYPTO_AVAILABLE:
        return envelope  # graceful degradation
    key = base64.b64decode(key_b64)
    iv  = base64.b64decode(envelope["iv"])
    ct  = base64.b64decode(envelope["ct"])
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(iv, ct, None)
    return json.loads(plain.decode("utf-8"))


def _is_envelope(val: Any) -> bool:
    return (
        isinstance(val, dict) and
        val.get("_lp_enc") is True and
        "iv" in val and "ct" in val
    )


def compute_diff(original: Any, patched: Any) -> Any:
    if original == patched:
        return None

    if not isinstance(original, dict) or not isinstance(patched, dict):
        if original != patched:
            return {"from": original, "to": patched}
        return None

    changes = {}
    has_changes = False
    all_keys = set(original.keys()).union(set(patched.keys()))

    for key in all_keys:
        o_v = original.get(key)
        p_v = patched.get(key)

        if key not in original:
            changes[key] = {"from": None, "to": p_v}
            has_changes = True
        elif key not in patched:
            changes[key] = {"from": o_v, "to": None}
            has_changes = True
        else:
            nested_diff = compute_diff(o_v, p_v)
            if nested_diff is not None:
                changes[key] = nested_diff
                has_changes = True

    return changes if has_changes else None


logger = logging.getLogger("letsping")

DEFAULT_BASE_URL = "https://letsping.co/api"
try:
    VERSION = _pkg_version("letsping")
except PackageNotFoundError:
    VERSION = "0.1.2"  # fallback during local development

__all__ = [
    "LetsPing",
    "LetsPingError",
    "AuthenticationError",
    "ApprovalRejectedError",
    "TimeoutError",
    "Decision",
    "Priority",
    "Status"
]

Status = Literal["APPROVED", "REJECTED", "PENDING", "APPROVED_WITH_MODIFICATIONS"]

class Decision(TypedDict):
    status: Status
    payload: Dict[str, Any]
    patched_payload: Optional[Dict[str, Any]]
    diff_summary: Optional[Dict[str, Any]]
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
        timeout: float = 30.0,
        encryption_key: Optional[str] = None,
    ):
        self._api_key = api_key or os.getenv("LETSPING_API_KEY")
        if not self._api_key:
            raise ValueError("LetsPing API Key must be provided via arg or LETSPING_API_KEY env var.")

        self._enc_key = encryption_key or os.getenv("LETSPING_ENCRYPTION_KEY") or None

        self._base_url = (base_url or os.getenv("LETSPING_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"letsping-python/{VERSION}",
            "Accept": "application/json"
        }
        self._client  = httpx.Client(base_url=self._base_url, headers=self._headers, timeout=self._timeout)
        self._aclient = httpx.AsyncClient(base_url=self._base_url, headers=self._headers, timeout=self._timeout)

    def _encrypt(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self._enc_key:
            return payload
        return _encrypt_payload(self._enc_key, payload)

    def _decrypt(self, val: Any) -> Any:
        if not self._enc_key or not _is_envelope(val):
            return val
        try:
            return _decrypt_payload(self._enc_key, val)
        except Exception:
            return val  # wrong key or corrupt — return as-is

    def close(self) -> None:
        """Close the synchronous HTTP client. Call this when done in non-async usage."""
        try:
            self._client.close()
        except Exception:
            pass

    async def aclose(self) -> None:
        """Close the async HTTP client. Awaited automatically when used as `async with`."""
        try:
            await self._aclient.aclose()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.aclose()

    def __del__(self):
        try:
            self._client.close()
        except Exception:
            pass

    def ask(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium", 
        role: Optional[str] = None,
        timeout: int = 86400
    ) -> Decision:
        """
        Pauses execution until a human decision is rendered.
        
        This is a blocking call that polls the LetsPing control plane.
        
        Args:
            service: Name of the agent or service (e.g., "billing-agent").
            action: Specific action being requested (e.g., "refund_user").
            payload: Dictionary of arguments to be reviewed.
            priority: Urgency level ("low", "medium", "high", "critical").
            role: (Enterprise) Specific role required for approval (e.g., "finance").
            timeout: Max time to wait in seconds (default: 24h).
            
        Returns:
            Decision: Dict containing status ("APPROVED"|"REJECTED") and approved payload.
            
        Raises:
            ApprovalRejectedError: If the human rejects the request.
            TimeoutError: If no decision is made within the timeout period.
        """
        request_id = self.defer(service, action, payload, priority, role=role)
        return self.wait(request_id, timeout=timeout)

    def defer(
        self, 
        service: str, 
        action: str, 
        payload: Dict[str, Any], 
        priority: Priority = "medium",
        role: Optional[str] = None,
        callback_url: Optional[str] = None
    ) -> str:
        """
        Registers a request and returns immediately (Non-blocking).
        
        Use this if you want to implement your own polling or handle the request ID asynchronously.
        
        Returns:
            str: The unique Request ID.
        """
        metadata = {"sdk": "python"}
        if role:
            metadata["role"] = role
        if callback_url:
            metadata["callback_url"] = callback_url

        body = {
            "service":  service,
            "action":   action,
            "payload":  self._encrypt(payload),
            "priority": priority,
            "metadata": metadata
        }

        resp = self._handle_response(self._client.post("/ingest", json=body))
        return resp["id"]

    def wait(self, request_id: str, timeout: int = 86400) -> Decision:
        """Resumes waiting for an existing request ID."""
        start_time = time.time()
        attempt = 0
        
        while time.time() - start_time < timeout:
            attempt += 1
            try:
                resp = self._client.get(f"/status/{request_id}")
                
                if resp.status_code == 200:
                    decision = resp.json()
                    if decision["status"] in ("APPROVED", "REJECTED"):
                        return self._parse_decision(decision)
                
                elif resp.status_code not in (404, 429, 500, 502, 503, 504):
                   self._handle_response(resp)
                   
            except (httpx.RequestError, json.JSONDecodeError) as e:
                logger.warning(f"LetsPing polling transient error: {e}")

            sleep_time = min(1.0 * (1.5 ** attempt), 10.0)
            time.sleep(sleep_time + random.uniform(0, 0.2))

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
        priority: Priority = "medium",
        role: Optional[str] = None,
    ) -> str:
        metadata: Dict[str, Any] = {"sdk": "python"}
        if role:
            metadata["role"] = role
        body = {
            "service":  service,
            "action":   action,
            "payload":  self._encrypt(payload),
            "priority": priority,
            "metadata": metadata,
        }
        resp = await self._aclient.post("/ingest", json=body)
        data = self._handle_response(resp)
        return data["id"]

    async def await_(self, request_id: str, timeout: int = 86400) -> Decision:
        start_time = time.time()
        attempt = 0
        
        while time.time() - start_time < timeout:
            attempt += 1
            try:
                resp = await self._aclient.get(f"/status/{request_id}")
                if resp.status_code == 200:
                    decision = resp.json()
                    if decision["status"] in ("APPROVED", "REJECTED"):
                        return self._parse_decision(decision)
                elif resp.status_code not in (404, 429, 500, 502, 503, 504):
                    self._handle_response(resp)

            except (httpx.RequestError, json.JSONDecodeError):
                pass 

            sleep_time = min(1.0 * (1.5 ** attempt), 10.0)
            await asyncio.sleep(sleep_time + random.uniform(0, 0.2))

        raise TimeoutError(f"Async wait timed out after {timeout}s for request {request_id}")

    def tool(self, service: str, action: str, priority: Priority = "medium") -> Callable:
        """Returns a callable 'Tool' compatible with LangChain/CrewAI."""
        def human_approval_tool(context: str) -> str:
            try:
                if isinstance(context, str):
                    try:
                        payload = json.loads(context)
                    except json.JSONDecodeError:
                        payload = {"raw_context": context}
                elif isinstance(context, dict):
                    payload = context
                else:
                    payload = {"raw_context": str(context)}
            
                try:
                    result = self.ask(service, action, payload, priority)
                    
                    if result["status"] == "REJECTED":
                        return f"STOP: Action Rejected by Human."

                    if result["status"] == "APPROVED_WITH_MODIFICATIONS":
                        return json.dumps({
                            "status": "APPROVED_WITH_MODIFICATIONS",
                            "message": "The human reviewer authorized this action but modified your original payload. Please review the diff_summary to learn from this correction.",
                            "diff_summary": result.get("diff_summary"),
                            "original_payload": result["payload"],
                            "executed_payload": result["patched_payload"]
                        })
                    
                    return json.dumps({
                        "status": "APPROVED",
                        "executed_payload": result["payload"]
                    })
                    
                except Exception as e:
                    return f"ERROR: System Failure: {str(e)}"
                
            except Exception as e:
                return f"ERROR: Input parsing failed: {str(e)}"
                
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
            except Exception:
                pass
            raise LetsPingError(f"API Error {response.status_code}: {error_msg}") from e

    def _parse_decision(self, data: Dict[str, Any]) -> Decision:
        status = data.get("status")

        if status == "REJECTED":
            return {
                "status": "REJECTED",
                "payload": self._decrypt(data.get("payload", {})),
                "patched_payload": None,
                "diff_summary": None,
                "metadata": data.get("metadata", {})
            }

        original = self._decrypt(data.get("payload", {}))
        raw_patched = data.get("patched_payload")
        patched = self._decrypt(raw_patched) if raw_patched else None

        final_status = "APPROVED"
        diff_summary = None
        if patched is not None:
            final_status = "APPROVED_WITH_MODIFICATIONS"
            diff = compute_diff(original, patched)
            diff_summary = {"changes": diff} if diff else {"changes": "Unknown structure changes"}

        return {
            "status": final_status,
            "payload": original,
            "patched_payload": patched,
            "diff_summary": diff_summary,
            "metadata": data.get("metadata", {})
        }