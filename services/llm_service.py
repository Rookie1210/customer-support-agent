import os

from dotenv import load_dotenv
from groq import Groq


load_dotenv()


class LLMService:
    """Groq-backed response generation, isolated from the Flask route."""

    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")

    def generate_response(self, customer_id, message, memories):
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY must be set to use the LLM service.")

        client = Groq(api_key=self.api_key)
        memory_context = "\n".join(f"- {item}" for item in memories) or "No relevant memories were retrieved."
        system_prompt = """You are a helpful, concise customer-support agent.

Use supplied Hindsight memories only when relevant. These are the only prior customer facts available to you. Do not invent previous interactions, solutions, or outcomes. Clearly distinguish recalled information from what the customer says now.

When the history records a solution that worked, prefer it when relevant and mention that the memory says it worked. Avoid recommending a solution that the history records as failed unless you explain a relevant reason to retry it. If the same solution has both failed and worked at different times, acknowledge both and ask a focused question before assuming which result applies now.

Treat "advised" as a recommendation only, "attempted" as tried with no reported result, "unconfirmed" as an outcome not yet known, "failed" as customer-reported failure, and "worked" as customer-confirmed success. Never turn advice or an unconfirmed attempt into a success or failure claim. Ask for clarification when the solution or its outcome is unclear.

Do not provide step-by-step instructions, app-specific menu paths, button labels, or account procedures unless those exact details appear in the supplied context. Never ask the customer to disclose a PIN, OTP, or password. Keep replies concise and focused on the current issue. If no relevant memories were retrieved, respond normally without pretending to remember the customer."""
        user_content = (
            f"Customer identity: {customer_id}\n"
            f"Current customer message: {message}\n\n"
            f"Retrieved Hindsight memories (these are the only available prior context):\n{memory_context}"
        )

        try:
            result = client.chat.completions.create(
                model="openai/gpt-oss-120b",
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
        finally:
            client.close()
