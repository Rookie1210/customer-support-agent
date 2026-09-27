import os
from dotenv import load_dotenv
from hindsight_client import Hindsight

load_dotenv()

client = Hindsight(
    base_url=os.getenv("HINDSIGHT_BASE_URL"),
    api_key=os.getenv("HINDSIGHT_API_KEY")
)

bank_id = os.getenv("HINDSIGHT_BANK_ID")

# Store a customer's previous support experience
client.retain(
    bank_id=bank_id,
    content=(
        "Customer Rahul uses the Android app and UPI for payments. "
        "On September 27, 2026, Rahul reported that a payment failed. "
        "Re-authentication solved the issue."
    )
)

# Ask Hindsight to recall relevant information
result = client.recall(
    bank_id=bank_id,
    query="What happened with Rahul's previous payment problem and what solved it?"
)

print("\n--- HINDSIGHT MEMORY ---\n")

for memory in result.results:
    print(memory.text)

client.close()