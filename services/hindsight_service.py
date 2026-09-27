import os

from dotenv import load_dotenv
from hindsight_client import Hindsight

load_dotenv()


class HindsightMemory:
    def __init__(self):
        self.client = Hindsight(
            base_url=os.getenv("HINDSIGHT_BASE_URL"),
            api_key=os.getenv("HINDSIGHT_API_KEY")
        )

        self.bank_id = os.getenv("HINDSIGHT_BANK_ID")

    def store_memory(self, content):
        """Store useful customer information in Hindsight."""
        return self.client.retain(
            bank_id=self.bank_id,
            content=content
        )

    def recall_memories(self, query):
        """Retrieve memories relevant to the current customer issue."""
        result = self.client.recall(
            bank_id=self.bank_id,
            query=query
        )

        return [memory.text for memory in result.results]

    def close(self):
        self.client.close()