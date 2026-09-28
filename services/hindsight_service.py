import asyncio
import hashlib
import os
import re

from dotenv import load_dotenv
from hindsight_client import Hindsight


load_dotenv()


class HindsightMemory:
    """Customer-scoped memory operations for the support agent."""

    def __init__(self):
        self.base_url = os.getenv("HINDSIGHT_BASE_URL")
        self.api_key = os.getenv("HINDSIGHT_API_KEY")
        self.bank_id = os.getenv("HINDSIGHT_BANK_ID")

    def _new_client(self):
        if not self.base_url or not self.api_key or not self.bank_id:
            raise RuntimeError("Hindsight configuration is incomplete.")
        return Hindsight(base_url=self.base_url, api_key=self.api_key)

    @staticmethod
    def _customer_tag(customer_id):
        digest = hashlib.sha256(customer_id.strip().casefold().encode("utf-8")).hexdigest()
        return f"customer:{digest}"

    @staticmethod
    def _fingerprint_tag(fingerprint):
        return f"support-event:{fingerprint}"

    @staticmethod
    def _recall_group(text):
        value = (
            text.casefold()
            .replace("\u2010", "-")
            .replace("\u2011", "-")
            .replace("\u2013", "-")
            .replace("\u2014", "-")
        )
        solution = None
        if re.search(r"re[\s-]?auth|reauth|re[\s-]?link", value):
            solution = "reauthentication"
        elif re.search(r"clear(?:ed|ing)? (?:the )?(?:app )?cache", value):
            solution = "clear-cache"
        elif re.search(r"reinstall", value):
            solution = "reinstall"
        elif re.search(r"restart(?:ing)? (?:the )?(?:app|device|phone)", value):
            solution = "restart"

        failed = re.search(
            r"outcome\s*:\s*failed|didn['’]?t work|did not work|failed to resolve|no change|"
            r"persisted|remained unresolved|still unresolved",
            value,
        )
        worked = re.search(
            r"outcome\s*:\s*worked|resolved (?:the|his|her|their|a|an|previous)|"
            r"(?:method|solution) (?:has )?(?:worked|resolved)|successfully resolved|"
            r"\b(?:worked|fixed|solved|effective)\b",
            value,
        )
        attempted = re.search(
            r"outcome\s*:\s*attempted|solution status\s*:\s*attempted|"
            r"\b(?:customer reported trying|tried the (?:suggested )?(?:fix|solution))\b",
            value,
        )
        advice = re.search(r"\b(?:advised|recommended|suggested)\b", value)

        if solution:
            outcome = (
                "failed"
                if failed
                else "worked"
                if worked
                else "attempted"
                if attempted
                else "unconfirmed"
                if advice or re.search(r"outcome\s*:\s*unconfirmed", value)
                else None
            )
            if outcome:
                return ("solution", solution, outcome)

        if re.search(r"\b(?:uses|using)\b", value) and "android" in value and "upi" in value:
            return ("profile", "upi-android")
        if re.search(r"\bupi\b", value) and re.search(r"payment|transaction", value):
            recurrence = bool(re.search(r"\b(?:again|recurr|still)\b", value))
            return ("issue", "upi-payment", "recurring" if recurrence else "initial")
        if re.search(r"payment|transaction", value):
            recurrence = bool(re.search(r"\b(?:again|recurr|still)\b", value))
            return ("issue", "payment", "recurring" if recurrence else "initial")
        return ("text", " ".join(value.split()))

    @staticmethod
    def _recall_specificity(text):
        value = text.casefold()
        return (
            bool(re.search(r"\b(?:android|ios|iphone|web app|website)\b", value)),
            bool(re.search(r"\b(?:customer confirmed|previously resolved|successfully resolved|outcome:)\b", value)),
            len(text),
        )

    @classmethod
    def _deduplicate_recalled(cls, memories):
        grouped = {}
        for text in memories:
            group = cls._recall_group(text)
            current = grouped.get(group)
            if current is None or cls._recall_specificity(text) > cls._recall_specificity(current):
                grouped[group] = text
        return list(grouped.values())

    def store_memory(self, content, customer_id=None, fingerprint=None):
        """Retain a support memory with customer and optional idempotency tags."""
        tags = []
        if customer_id:
            tags.append(self._customer_tag(customer_id))
        if fingerprint:
            tags.append(self._fingerprint_tag(fingerprint))

        client = self._new_client()
        try:
            return client.retain(
                bank_id=self.bank_id,
                content=content,
                tags=tags or None,
            )
        finally:
            client.close()

    def has_support_fingerprint(self, customer_id, fingerprint):
        """Check active, customer-scoped Hindsight records for an idempotency tag."""
        customer_tag = self._customer_tag(customer_id)
        fingerprint_tag = self._fingerprint_tag(fingerprint)
        client = self._new_client()
        try:
            page = asyncio.run(
                client.memory.list_memories(
                    bank_id=self.bank_id,
                    state="valid",
                    tags=[customer_tag, fingerprint_tag],
                    tags_match="all_strict",
                    limit=1,
                )
            )
            items = page.items if hasattr(page, "items") else page.get("items", [])
            return bool(items)
        finally:
            client.close()

    def recall_memories(self, query, customer_id=None):
        """Recall only memories carrying the requested customer's private tag."""
        client = self._new_client()
        try:
            if customer_id:
                result = client.recall(
                    bank_id=self.bank_id,
                    query=query,
                    tags=[self._customer_tag(customer_id)],
                    tags_match="any_strict",
                )
            else:
                result = client.recall(bank_id=self.bank_id, query=query)

            memories = []
            seen = set()
            for memory in result.results:
                text = memory.text.strip()
                key = " ".join(text.casefold().split())
                if text and key not in seen:
                    memories.append(text)
                    seen.add(key)
            return self._deduplicate_recalled(memories)
        finally:
            client.close()

    def list_customer_memories(self, customer_id, limit=100):
        """List active records carrying only the requested customer's tag."""
        if not customer_id:
            return []

        client = self._new_client()
        try:
            page = asyncio.run(
                client.memory.list_memories(
                    bank_id=self.bank_id,
                    state="valid",
                    tags=[self._customer_tag(customer_id)],
                    tags_match="any_strict",
                    limit=limit,
                )
            )
            items = page.items if hasattr(page, "items") else page.get("items", [])
            memories = []
            seen = set()
            for item in items:
                text = item.get("text", "") if isinstance(item, dict) else getattr(item, "text", "")
                if not isinstance(text, str):
                    continue
                text = text.strip()
                timestamp = None
                for name in ("occurred_start", "var_date", "mentioned_at", "updated_at"):
                    value = item.get(name) if isinstance(item, dict) else getattr(item, name, None)
                    if value is not None:
                        timestamp = value.isoformat() if hasattr(value, "isoformat") else str(value).strip()
                        if timestamp:
                            break
                normalized = " ".join(text.casefold().split())
                key = normalized + ("|" + timestamp if timestamp else "")
                if text and key not in seen:
                    if timestamp and not re.search(r"^\s*Timestamp\s*:", text, re.I | re.M):
                        text += f"\nTimestamp: {timestamp}"
                    memories.append(text)
                    seen.add(key)
            # Keep distinct event records intact here so the structured
            # customer-history API can aggregate outcomes in its presentation
            # without losing attempts or their timestamps.
            return memories
        finally:
            client.close()
