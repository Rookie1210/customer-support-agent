import os

from dotenv import load_dotenv
from xai_sdk import Client
from xai_sdk.chat import system, user


load_dotenv()


class LLMService:
    """xAI Grok response generation, isolated from the Flask route."""

    def __init__(self):
        self.api_key = os.getenv("XAI_API_KEY")

    def generate_response(self, customer_id, message, memories):
        if not self.api_key:
            raise RuntimeError("XAI_API_KEY must be set to use the LLM service.")

        client = Client(api_key=self.api_key)
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

        chat = client.chat.create(model="grok-4.7")
        chat.append(system(system_prompt))
        chat.append(user(user_content))
        result = chat.sample()
        content = result.content
        if not content:
            raise RuntimeError("The LLM returned an empty response.")
        return content.strip()
