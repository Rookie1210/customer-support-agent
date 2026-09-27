import hashlib
import re
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request

from services.hindsight_service import HindsightMemory
from services.llm_service import LLMService


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16_384
memory = HindsightMemory()
llm = LLMService()


def _clean_memories(memories, limit=8, preserve_lines=False):
    selected = []
    seen = set()
    for item in memories:
        if not isinstance(item, str):
            continue
        if preserve_lines:
            text = "\n".join(line.strip() for line in item.splitlines() if line.strip())
        else:
            text = " ".join(item.split()).strip()
        key = " ".join(text.casefold().split())
        if text and key not in seen:
            selected.append(text)
            seen.add(key)
        if len(selected) >= limit:
            break
    return selected


def _issue_from_text(text):
    value = text.casefold()
    if re.search(r"\bupi\b", value) and re.search(
        r"\b(pay(?:ment|ments)?|transaction|transfer)\w*\b", value
    ):
        return "UPI payment failure"
    if re.search(r"\b(pay(?:ment|ments)?|transaction|transfer)\w*\b", value):
        return "Payment failure"
    if re.search(r"\b(log ?in|sign ?in|account access)\w*\b", value):
        return "Account sign-in issue"
    if re.search(r"\b(order|delivery|shipment)\w*\b", value):
        return "Order or delivery issue"
    if re.search(r"\b(refund|reimbursement)\w*\b", value):
        return "Refund issue"
    return None


def _platform_from_text(text):
    value = text.casefold()
    for name, pattern in (
        ("Android", r"\bandroid\b"),
        ("iOS", r"\b(?:ios|iphone|ipad)\b"),
        ("Web", r"\b(?:website|web app|browser)\b"),
    ):
        if re.search(pattern, value):
            return name
    return None


def _solution_from_text(text):
    value = text.casefold().replace("\u2010", "-").replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    if re.search(r"re[\s-]?auth|reauth|re[\s-]?link", value):
        return "Re-authentication or UPI re-linking"
    if re.search(r"clear(?:ing)? (?:the )?cache", value):
        return "Clear cache"
    if re.search(r"reinstall(?:ing)?", value):
        return "Reinstall the app"
    if re.search(r"restart(?:ing)? (?:the )?(?:app|device|phone)", value):
        return "Restart the app or device"
    if re.search(r"update(?:d|ing)? (?:the )?app", value):
        return "Update the app"
    if re.search(r"contact(?:ing)? (?:your )?(?:bank|support)", value):
        return "Contact the bank or support"
    return None


def _outcome_from_customer_message(message):
    value = message.casefold()
    if re.search(
        r"\b(?:didn['’]?t|did not|doesn['’]?t|does not|hasn['’]?t|has not)\s+(?:work|help|fix)\b"
        r"|\b(?:that|it|the fix|the solution)\s+(?:failed|didn['’]?t work|did not work)\b"
        r"|\bno change\b|\bstill (?:doesn['’]?t|does not|isn['’]?t|is not) working\b",
        value,
    ):
        return "failed"
    if re.search(
        r"\b(?:fixed|resolved|solved) (?:it|the issue|the problem)\b"
        r"|\b(?:it|that|the fix|the solution) worked\b"
        r"|\bworking now\b|\bpayment went through\b",
        value,
    ):
        return "worked"
    if re.search(r"\b(?:i|we) (?:tried|attempted)\b|\btried the (?:suggested )?(?:fix|solution)\b", value):
        return "attempted"
    return "unconfirmed"


def _candidate_event(customer_id, message, response, recalled_memories):
    context_text = "\n".join([message, *recalled_memories])
    issue = _issue_from_text(message) or _issue_from_text(context_text)
    if not issue:
        return None

    platform = _platform_from_text(message) or _platform_from_text(context_text)
    outcome = _outcome_from_customer_message(message)
    solution = _solution_from_text(message)

    if not solution and outcome in {"failed", "worked", "attempted"}:
        remembered_solutions = {
            _solution_from_text(item)
            for item in recalled_memories
            if _solution_from_text(item)
            and re.search(r"\b(?:advised|recommended|suggested|solution)\b", item, re.I)
        }
        if len(remembered_solutions) == 1:
            solution = remembered_solutions.pop()

    if not solution and outcome == "unconfirmed":
        solution = _solution_from_text(response)

    if outcome == "attempted":
        action_status = "attempted"
    elif outcome in {"failed", "worked"}:
        action_status = "customer-confirmed"
    else:
        action_status = "advised" if solution else "unconfirmed"
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    fingerprint = _event_fingerprint(customer_id, issue, solution, outcome)
    content = (
        f"Customer: {customer_id}\n"
        f"Issue: {issue}\n"
        f"Platform/context: {platform or 'Not specified'}\n"
        f"Solution: {solution or 'No specific solution identified'}\n"
        f"Solution status: {action_status}\n"
        f"Outcome: {outcome}\n"
        f"Customer message: {message[:500]}\n"
        f"Timestamp: {timestamp}"
    )
    return {
        "content": content,
        "fingerprint": fingerprint,
        "base_fingerprint": fingerprint,
        "episode_after": None,
        "issue": issue,
        "solution": solution,
        "outcome": outcome,
    }


def _event_fingerprint(customer_id, issue, solution, outcome):
    fields = "\n".join(
        (
            customer_id.strip().casefold(),
            issue.casefold(),
            (solution or "no solution identified").casefold(),
            outcome,
        )
    )
    return hashlib.sha256(fields.encode("utf-8")).hexdigest()


def _memory_outcome(text):
    structured = re.search(
        r"\boutcome\s*:\s*(attempted|failed|worked|unconfirmed)\b", text, re.I
    )
    if structured:
        return structured.group(1).lower()
    outcome = _outcome_from_customer_message(text)
    if outcome != "unconfirmed":
        return outcome
    if re.search(r"\b(?:resolved|fixed|solved|worked|effective)\b", text, re.I):
        return "worked"
    if re.search(
        r"\b(?:did not work|didn't work|no change|failed to resolve|persisted|remained unresolved|still unresolved)\b",
        text,
        re.I,
    ):
        return "failed"
    return outcome


def _mark_new_outcome_episode(event, customer_id, recalled_memories):
    if event["outcome"] not in {"failed", "worked"} or not event["solution"]:
        return event

    opposite = "failed" if event["outcome"] == "worked" else "worked"
    prior_opposite = any(
        _issue_from_text(item) == event["issue"]
        and _solution_from_text(item) == event["solution"]
        and _memory_outcome(item) == opposite
        for item in recalled_memories
    )
    if prior_opposite:
        # A new, explicitly reported result after the opposite result is
        # meaningful. Give this outcome sequence its own repeatable tag so
        # retries of the same request still deduplicate.
        event["episode_after"] = opposite
        event["fingerprint"] = hashlib.sha256(
            f"{event['base_fingerprint']}\nafter:{opposite}".encode("utf-8")
        ).hexdigest()
        event["content"] += f"\nNew outcome after previous {opposite} report: yes"
    return event


def _memory_matches_event(text, event):
    issue = _issue_from_text(text)
    solution = _solution_from_text(text)
    return (
        issue == event["issue"]
        and solution == event["solution"]
        and _memory_outcome(text) == event["outcome"]
    )


def _event_is_duplicate(event, customer_id, recalled_memories):
    if memory.has_support_fingerprint(customer_id, event["fingerprint"]):
        return True

    if event["episode_after"]:
        return False

    # Match existing pre-fingerprint facts when Hindsight recalled a clear
    # duplicate. This protects the current bank's useful history from being
    # copied into the new structured format.
    return any(_memory_matches_event(item, event) for item in recalled_memories)


def _customer_id(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 128:
        return None
    return value


def _error(message, status):
    return jsonify({"error": message}), status


@app.get("/")
def home():
    return render_template("index.html")


@app.errorhandler(413)
def request_too_large(exception):
    return _error("This request is too large to process.", 413)


def _structured_memory(text):
    message = re.search(r"^\s*Customer message:\s*(.*?)\s*$", text, re.I | re.M)
    return {
        "text": text,
        "issue": _issue_from_text(text),
        "platform": _platform_from_text(text),
        "solution": _solution_from_text(text),
        "outcome": _memory_outcome(text),
        "customer_message": message.group(1) if message else None,
    }


def _customer_memory_response(customer_id, structured=False):
    customer_id = _customer_id(customer_id)
    if not customer_id:
        return _error("Enter a valid customer ID to load customer history.", 400)
    try:
        if structured:
            recalled = memory.list_customer_memories(customer_id)
        else:
            recalled = memory.recall_memories(
                f"Customer {customer_id}: previous support issues, platforms, solutions attempted, and confirmed outcomes.",
                customer_id=customer_id,
            )
        memories = _clean_memories(recalled, preserve_lines=structured)
        if structured:
            memories = [_structured_memory(item) for item in memories]
        return jsonify(
            {
                "customer_id": customer_id,
                "memories": memories,
                "returning_customer": bool(memories),
            }
        )
    except Exception as error:
        app.logger.error("Customer history lookup failed (%s)", type(error).__name__)
        return _error("Customer history is temporarily unavailable. Please try again.", 503)


@app.get("/memories")
def customer_memories():
    return _customer_memory_response(request.args.get("customer_id"))


@app.get("/customers/<path:customer_id>/memories")
def customer_memories_by_id(customer_id):
    return _customer_memory_response(customer_id, structured=True)


@app.post("/chat")
def chat():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    customer_id = _customer_id(payload.get("customer_id"))
    message = payload.get("message")
    if not customer_id:
        return _error("Enter a valid customer ID.", 400)
    if not isinstance(message, str) or not message.strip():
        return _error("Enter a message before sending.", 400)
    message = message.strip()
    if len(message) > 4_000:
        return _error("Messages must be 4,000 characters or fewer.", 400)

    memory_query = f"Customer {customer_id}. Current support message: {message}"
    try:
        recalled_memories = _clean_memories(
            memory.recall_memories(memory_query, customer_id=customer_id)
        )
        response = llm.generate_response(customer_id, message, recalled_memories)

        event = _candidate_event(customer_id, message, response, recalled_memories)
        if event:
            # Search Hindsight for matching active customer history before
            # retaining, then use the stable tag for exact idempotency going
            # forward. Do not treat generated advice as a confirmed outcome.
            check_query = (
                f"{event['issue']}; solution {event['solution'] or 'not identified'}; "
                f"outcome {event['outcome']}"
            )
            duplicate_context = _clean_memories(
                recalled_memories
                + memory.recall_memories(check_query, customer_id=customer_id)
            )
            _mark_new_outcome_episode(event, customer_id, duplicate_context)
            if not _event_is_duplicate(event, customer_id, duplicate_context):
                memory.store_memory(
                    event["content"],
                    customer_id=customer_id,
                    fingerprint=event["fingerprint"],
                )

        return jsonify({"response": response, "memories": recalled_memories})
    except Exception as error:
        app.logger.error("Customer support request failed (%s)", type(error).__name__)
        return _error("The support service is temporarily unavailable. Please try again.", 503)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
