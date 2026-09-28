# SupportAI — Memory-powered customer support

A Flask support workspace that uses Groq for concise customer support and Hindsight for customer-scoped history. Rahul is the only customer shown on a fresh page load. Other customer IDs are added through **New customer**; each customer’s support memories remain scoped by Hindsight tags.

## Request flow

```text
Browser
  ├─ GET /customers/<customer_id>/memories
  │    └─ active Hindsight records tagged for that customer
  └─ POST /chat
       ├─ strict customer-specific Hindsight recall
       ├─ Groq receives the current message and recalled memories
       ├─ useful support event is fingerprint-checked
       ├─ explicit attempt/success/failure is retained when new
       └─ response, actual recalled memories, and retain status return to UI
```

Customer IDs are normalized into private SHA-256 tags. Recall never falls back to another customer or to untagged records. Support events include the issue, platform, solution, outcome, customer message, and timestamp. Stable fingerprints prevent repeated identical outcomes from being retained again; a new outcome can still be stored. Advice is unconfirmed until the customer reports what happened.

## API

`GET /` serves the frontend.

`GET /memories?customer_id=rahul` returns the customer’s semantic recall as strings.

`GET /customers/rahul/memories` returns active, customer-scoped records in structured form for the memory panel.

`POST /chat` accepts the existing fields and an optional structured outcome for the contextual result buttons:

```json
{
  "customer_id": "rahul",
  "message": "I tried re-authentication and it worked.",
  "outcome": {
    "status": "success",
    "solution": "Re-authentication or UPI re-linking"
  }
}
```

The original `{ "customer_id": "…", "message": "…" }` request remains supported. The response includes `response` and `memories` as before, plus `memory_updated`, `memory_update_error`, `outcome`, and `suggested_solution`. `memory_updated` is true only when a new Hindsight retain call completes successfully.

## Run locally

```bash
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`. The Flask app serves the HTML, CSS, and JavaScript. `.env` remains ignored by Git; configure `GROQ_API_KEY`, `HINDSIGHT_BASE_URL`, `HINDSIGHT_API_KEY`, and `HINDSIGHT_BANK_ID` in the local environment.

## Support outcomes

- `ATTEMPTED`: the customer tried the solution but has not reported a result.
- `SUCCESS`: the customer explicitly confirms it worked; the UI marks the conversation resolved and asks whether to continue or end.
- `FAILED`: the customer reports it did not work; the UI marks the conversation as needing attention.
- `UNCONFIRMED`: the agent recommended a solution, but there is no customer-confirmed result.

Ending a conversation changes only the conversation UI state. Hindsight history is retained. Starting a new conversation clears the current in-page thread state and reloads the same customer’s Hindsight history.

## Integration test note

`test_hindsight.py` is a live integration example that retains an untagged memory in the configured Hindsight bank. It is not a side-effect-free unit test; inspect the destination bank and run it only when that retain is intended.
