"""
LetsPing Python quickstart.

Run:
  python -m letsping.quickstart

This script submits one dangerous action request, prints the dashboard link,
then prints exactly what the agent sees on approval, rejection, or payload patching.
"""

import os
import json

from . import LetsPing, ApprovalRejectedError, LetsPingError


def main() -> None:
    api_key = os.getenv("LETSPING_API_KEY")
    if not api_key:
        raise SystemExit("Missing LETSPING_API_KEY env var.")

    lp = LetsPing(api_key=api_key)

    payload = {"query": "DROP TABLE users"}
    request_id = lp.defer(service="db-agent", action="sql", payload=payload, priority="high")

    print("LetsPing request created")
    print(f"Dashboard: https://letsping.co/requests/{request_id}")
    print("Waiting for human decision")

    try:
        decision = lp.wait(request_id, timeout=3600)
    except ApprovalRejectedError:
        print(json.dumps({"status": "REJECTED", "message": "Do not proceed."}, indent=2))
        return
    except LetsPingError as e:
        print(json.dumps({"status": "ERROR", "message": str(e), "code": getattr(e, "code", None)}, indent=2))
        return

    status = decision["status"]
    if status == "APPROVED_WITH_MODIFICATIONS":
        print(
            json.dumps(
                {
                    "status": status,
                    "diff_summary": decision.get("diff_summary"),
                    "original_payload": decision.get("payload"),
                    "executed_payload": decision.get("patched_payload"),
                },
                indent=2,
            )
        )
        return

    print(json.dumps({"status": "APPROVED", "executed_payload": decision.get("payload")}, indent=2))


if __name__ == "__main__":
    main()

