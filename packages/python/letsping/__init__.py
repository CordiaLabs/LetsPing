import os
import time
import requests
from typing import Optional, Dict, Any, Union, Literal
from pydantic import BaseModel, Field

class LetsPingResponse(BaseModel):
    id: str
    status: Literal["PENDING", "APPROVED", "REJECTED", "TIMEOUT"]
    payload: Dict[str, Any]
    resolved_at: Optional[str] = None
    metadata: Dict[str, Any] = {}

class LetsPingError(Exception):
    pass

class LetsPing:
    """
    The official LetsPing Python Client.
    
    Usage:
        lp = LetsPing(api_key="lp_sk_...")
        result = lp.ask(channel="finance", payload={...})
    """
    
    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://api.letsping.co/v1"):
        self.api_key = api_key or os.getenv("LETSPING_API_KEY")
        if not self.api_key:
            raise ValueError("LetsPing API Key is required. Set LETSPING_API_KEY env var or pass in constructor.")
        
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "letsping-python/0.1.0"
        })

    def ask(
        self, 
        channel: str, 
        payload: Dict[str, Any], 
        description: str = "",
        timeout_seconds: int = 3600,
        blocking: bool = True,
        poll_interval: int = 2
    ) -> LetsPingResponse:
        """
        Pauses execution and requests human approval for the given payload.
        
        Args:
            channel: The identifier for the team/workflow (e.g. "finance-approvals").
            payload: The JSON data to be reviewed/modified.
            description: Context for the human reviewer.
            timeout_seconds: Max time to wait before auto-rejecting.
            blocking: If True, blocks the thread until resolution.
            poll_interval: Seconds to wait between status checks (if blocking).
            
        Returns:
            LetsPingResponse object containing status and final payload.
        """
        try:
            # 1. Initialize the request
            init_resp = self.session.post(f"{self.base_url}/ask", json={
                "channel": channel,
                "payload": payload,
                "description": description,
                "timeout": timeout_seconds
            })
            init_resp.raise_for_status()
            data = init_resp.json()
            request_id = data["id"]
            
            if not blocking:
                return LetsPingResponse(**data)
            
            # 2. Poll for resolution (Durable Wait simulation)
            start_time = time.time()
            while (time.time() - start_time) < timeout_seconds:
                check_resp = self.session.get(f"{self.base_url}/requests/{request_id}")
                if check_resp.status_code == 200:
                    status_data = check_resp.json()
                    if status_data["status"] != "PENDING":
                        return LetsPingResponse(**status_data)
                
                time.sleep(poll_interval)
            
            return LetsPingResponse(
                id=request_id,
                status="TIMEOUT",
                payload=payload,
                metadata={"error": "Polling timed out locally"}
            )

        except requests.exceptions.RequestException as e:
            raise LetsPingError(f"Connection failed: {str(e)}") from e