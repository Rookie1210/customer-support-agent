import os

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()


class LLMService:
    """OpenAI-backed response generation, isolated from the Flask route."""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY must be set to use the LLM service.")

        self.client = OpenAI(api_key=api_key)
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def generate_response(self, customer_id, message, memories):
        memory_context = "\n".join(f"- {item}" for item in memories) or "No relevant memories were retrieved."
        system_prompt = (
            "You are a helpful, concise customer-support agent. Use retrieved customer memories "
            "only when relevant. Never invent or imply previous interactions unless they appear "
            "in the supplied retrieved memories. Clearly distinguish current information from "
            "recalled information. If no relevant memories were retrieved, respond normally to "
            "the current message without pretending to remember the customer. Ask for clarification "
            "when needed. Do not claim an action or resolution that has not happened."
        )
        user_content = (
            f"Customer identity: {customer_id}\n"
            f"Current customer message: {message}\n\n"
            f"Retrieved Hindsight memories (these are the only available prior context):\n{memory_context}"
        )

        result = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
        )
        content = result.choices[0].message.content
        if not content:
            raise RuntimeError("The LLM returned an empty response.")
        return content.strip()
