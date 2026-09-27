# Memory-Powered Customer Support Agent

A small Flask support prototype that combines a chat interface, Groq response generation, and customer-scoped Hindsight memory. The assistant can use a customer's prior support history while keeping other customer IDs out of the recall scope.

## Why memory matters

Customers should not need to repeat the same background every time they contact support. Hindsight can provide relevant prior issues and outcomes, so the assistant can favor a previously successful solution, avoid repeating a failed one without a reason, and ask what happened when an outcome is still unknown.

## Architecture

```text
Browser
  ├─ GET /memories?customer_id=… ──> Hindsight recall for that customer tag
  └─ POST /chat {customer_id, message}
       ├─ Hindsight recall, scoped to the customer tag
       ├─ Groq chat completion with current message + recalled memories
       ├─ Build a structured issue / solution / outcome event
       ├─ Check Hindsight history and its idempotency tag
       └─ Hindsight retain only when the event adds information
```

The Flask API uses one Hindsight bank. Customer IDs are normalized and hashed into customer tags; recall uses a strict tagged scope and does not fall back to global or untagged memories. The existing chat response stays `{ "response": "…", "memories": [] }`; `memories` contains the recalled context supplied to Groq.

## Hindsight integration

`services/hindsight_service.py` owns Hindsight operations. Retained facts carry a customer tag and, for support events, a second stable fingerprint tag. The fingerprint covers normalized customer ID, issue, solution, and outcome. Before retaining, the application checks Hindsight for that fingerprint and compares recalled legacy facts where possible. It does not create a separate database or bank for each customer.

Useful events are stored with customer, issue, platform/context, solution, solution status, outcome, customer message, and timestamp. Repeated identical issue/solution/outcome combinations are skipped. A new outcome, such as a solution changing from unconfirmed to failed, has a different fingerprint and can be retained.

## Groq integration

`services/llm_service.py` isolates the official Groq Python client and uses the configured `openai/gpt-oss-120b` model. The prompt distinguishes advice, attempts, failed outcomes, successful outcomes, and unconfirmed outcomes. It tells the assistant to prefer a relevant confirmed success, avoid a known failure unless there is a reason to retry, and never invent customer history or outcomes.

## Customer-specific history and outcomes

The sidebar includes Rahul, Priya, and Arjun as demo shortcuts. Any customer name or ID can also be entered. Switching customers clears the visible conversation and loads only memories tagged for the newly selected ID. A new customer sees an empty-history state; no other customer's memories are used as a fallback.

The memory panel groups recalled facts into prior issue, platform, previous attempts, and recent customer update. It labels the context as supplied to the AI only after `/chat` returns that exact memory list. Similar observations are collapsed visually rather than shown as repeated raw entries.

The agent records a failed or worked outcome only when the customer explicitly says so. Assistant recommendations are retained as advice with an unconfirmed outcome; advice alone is never treated as proof of success.

## Run locally

Use the project virtual environment and install the dependencies if needed:

```bash
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000` in a browser. The frontend is served by Flask; its requests go to the Flask API.

## Environment variables

Set these names in the local environment file or process environment. Do not commit actual credentials:

- `GROQ_API_KEY`
- `HINDSIGHT_BASE_URL`
- `HINDSIGHT_API_KEY`
- `HINDSIGHT_BANK_ID`

`.env` is listed in `.gitignore`.

## Demo flow

1. Open Rahul to see his existing tagged support history.
2. Send `My UPI payment is failing on Android.` and review which memories were supplied with the response.
3. Send `I tried the suggested fix but it didn't work.` to report a failed attempt.
4. Send `Re-authentication fixed it.` to record a confirmed result if the recalled context supports that attribution.
5. Return later with `My UPI payment is failing again.` and check that the agent distinguishes prior outcomes.
6. Switch to Priya. Her panel should show no Rahul history; a message from Priya creates history under Priya's own tag.
7. Switch back to Rahul or refresh. The selected customer's tagged history loads again.

`GET /` serves the interface, `GET /memories?customer_id=...` loads a customer's relevant history, and `POST /chat` accepts `{ "customer_id": "rahul", "message": "..." }`.
