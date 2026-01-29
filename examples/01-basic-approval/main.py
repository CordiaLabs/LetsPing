import os
from letsping import LetsPing

# Configuration
API_KEY = os.getenv("LETSPING_API_KEY")
lp = LetsPing(api_key=API_KEY)

def run_sensitive_task():
    """
    Simulates an AI agent attempting to execute a sensitive database operation.
    """
    
    # 1. The payload the agent WANTS to execute
    proposed_query = {
        "operation": "DELETE",
        "target_table": "users_prod",
        "where_clause": "last_login < '2023-01-01'",
        "limit": 5000
    }
    
    print(f"[-] Agent proposing DB Cleanup: {proposed_query}")

    # 2. Pause and wait for human review
    print("[-] Pausing for human verification via LetsPing...")
    
    result = lp.ask(
        channel="db-ops",
        payload=proposed_query,
        description="Agent 007 requesting bulk deletion of inactive users.",
        blocking=True
    )

    # 3. Handle the result
    if result.status == "APPROVED":
        print(f"[+] APPROVED. Executing query with parameters: {result.payload}")
        # Note: Humans may have modified the 'limit' or 'where_clause' in the UI
        # execute_db(result.payload)
    elif result.status == "REJECTED":
        print("[!] REJECTED. Stopping execution.")
    else:
        print(f"[?] Status: {result.status}")

if __name__ == "__main__":
    run_sensitive_task()