from flask import Flask, jsonify, request

from services.hindsight_service import HindsightMemory
from services.llm_service import LLMService


app = Flask(__name__)
memory = HindsightMemory()
llm = LLMService()


@app.get("/")
def health():
    return jsonify({"message": "Customer Support Agent backend is running."})


@app.post("/chat")
def chat():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    customer_id = payload.get("customer_id")
    message = payload.get("message")
    if not isinstance(customer_id, str) or not customer_id.strip():
        return jsonify({"error": "customer_id is required."}), 400
    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "message is required."}), 400

    customer_id = customer_id.strip()
    message = message.strip()
    memory_query = f"Customer {customer_id}. Current support message: {message}"

    try:
        recalled_memories = memory.recall_memories(
            memory_query,
            customer_id=customer_id,
        )
        relevant_memories = []
        seen_memories = set()
        for item in recalled_memories:
            normalized = item.strip().casefold()
            if normalized not in seen_memories:
                relevant_memories.append(item)
                seen_memories.add(normalized)
            if len(relevant_memories) == 5:
                break
        recalled_memories = relevant_memories
        response = llm.generate_response(customer_id, message, recalled_memories)

        # Store substantive exchanges only. Keep the stored text grounded in the
        # customer's message and the response that was actually sent.
        if len(message.split()) >= 4:
            stored_interaction = (
                f"Customer {customer_id} reported: {message[:500]}. "
                f"Support response: {response[:500]}"
            )
            memory.store_memory(stored_interaction, customer_id=customer_id)

        return jsonify({"response": response, "memories": recalled_memories})
    except Exception:
        app.logger.exception("Customer support chat request failed")
        return jsonify({"error": "The support service is temporarily unavailable."}), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
