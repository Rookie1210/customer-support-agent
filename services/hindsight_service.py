import hashlib
import os

from dotenv import load_dotenv
from hindsight_client import Hindsight

load_dotenv()


class HindsightMemory:
    def __init__(self):
        self.base_url = os.getenv("HINDSIGHT_BASE_URL")
        self.api_key = os.getenv("HINDSIGHT_API_KEY")
        self.bank_id = os.getenv("HINDSIGHT_BANK_ID")

    def _new_client(self):
        return Hindsight(base_url=self.base_url, api_key=self.api_key)

    @staticmethod
    def _customer_tag(customer_id):
        digest = hashlib.sha256(customer_id.strip().casefold().encode("utf-8")).hexdigest()
        return f"customer:{digest}"

    def store_memory(self, content, customer_id=None):
        """Store useful customer information in Hindsight."""
        options = {}
        if customer_id:
            options["tags"] = [self._customer_tag(customer_id)]
        client = self._new_client()
        try:
            return client.retain(
                bank_id=self.bank_id,
                content=content,
                **options,
            )
        finally:
            client.close()

    def recall_memories(self, query, customer_id=None):
        """Retrieve memories relevant to the current customer issue."""
        client = self._new_client()
        try:
            if customer_id:
                customer_tag = self._customer_tag(customer_id)
                result = client.recall(
                    bank_id=self.bank_id,
                    query=query,
                    tags=[customer_tag],
                    tags_match="exact",
                )
                memories = [memory.text for memory in result.results]
                if memories:
                    return memories

                # Keep older memories written before customer tags were added,
                # but only when their recalled text names this customer.
                result = client.recall(bank_id=self.bank_id, query=query)
                identity = customer_id.casefold()
                return [
                    memory.text
                    for memory in result.results
                    if identity in memory.text.casefold()
                ]

            result = client.recall(bank_id=self.bank_id, query=query)
            return [memory.text for memory in result.results]
        finally:
            client.close()
