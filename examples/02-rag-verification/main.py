import os
from letsping import LetsPing

lp = LetsPing(api_key=os.getenv("LETSPING_API_KEY"))

def verify_rag_retrieval():
    """
    Simulates a RAG pipeline where the retrieved context looks suspicious.
    """
    
    # Mock retrieved documents from Vector DB
    retrieved_docs = [
        {"id": 1, "text": "Product X pricing is $10/mo.", "score": 0.92},
        {"id": 2, "text": "Competitor Y pricing is $50/mo.", "score": 0.88}
    ]
    
    generated_answer = "Based on the docs, our pricing is $50/mo." # <-- Hallucination
    
    # Detect anomaly (simple heuristic for demo)
    if "50" in generated_answer and "10" in retrieved_docs[0]["text"]:
        print("[-] Hallucination detected. Escalating to human.")
        
        result = lp.ask(
            channel="hallucination-watch",
            payload={
                "question": "What is our pricing?",
                "context": retrieved_docs,
                "generated_answer": generated_answer
            },
            description="Model output contradicts top retrieval result."
        )
        
        if result.status == "APPROVED":
            # The human fixed the answer in the payload
            final_answer = result.payload["generated_answer"]
            print(f"[+] Sending Final Answer: {final_answer}")
        else:
            print("[-] Answer discarded.")

if __name__ == "__main__":
    verify_rag_retrieval()