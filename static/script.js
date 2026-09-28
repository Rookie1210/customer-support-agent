(function () {
  "use strict";

  var STATUS_LABELS = {
    "in-progress": "In Progress",
    resolved: "Resolved",
    "needs-attention": "Needs Attention",
    ended: "Ended",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function makeConversation() {
    return {
      messages: [],
      status: "in-progress",
      ended: false,
      resolutionPrompt: false,
      loading: false,
      error: "",
      lastFailedMessage: "",
      lastFailedOutcome: null,
      pendingMessage: "",
      pendingOutcome: null,
      feedback: "",
    };
  }

  function canonicalId(value) {
    return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  }

  function displayName(id) {
    return canonicalId(id) === "rahul" ? "Rahul" : id;
  }

  function nowTime() {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  }

  function dateKey(value) {
    var date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) date = new Date();
    return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
  }

  function dateLabel(value) {
    var date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) date = new Date();
    var today = new Date();
    var yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (dateKey(date) === dateKey(today)) return "Today";
    if (dateKey(date) === dateKey(yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
  }

  var firstConversation = makeConversation();
  var state = {
    customers: ["rahul"],
    currentCustomerId: "rahul",
    conversations: Object.create(null),
    active: firstConversation,
    historyMemories: [],
    recalledMemories: [],
    memoryMode: "history",
    memoryLoading: false,
    memoryError: false,
    memoryAvailable: null,
    memoryUpdateError: false,
    creatingCustomer: false,
    customerDraft: "",
    draft: "",
    generation: 0,
    sequence: 0,
    memoryController: null,
    chatController: null,
    memoryDrawerOpen: false,
  };
  state.conversations.rahul = firstConversation;

  var ids = [
    "customer-list", "customer-total", "customer-avatar", "conversation-heading",
    "conversation-status", "new-customer-button", "new-customer-form", "new-customer-id",
    "cancel-new-customer", "conversation", "message-form", "message-input", "send-button",
    "send-label", "new-conversation",
    "memory-count", "memory-status", "memory-status-title", "memory-status-copy",
    "memory-retry", "memory-body", "memory-footnote-copy", "memory-panel", "memory-toggle",
    "memory-close", "memory-scrim", "summary-button", "summary-dialog", "summary-close",
    "summary-content", "feedback", "feedback-thanks",
    "hindsight-indicator", "hindsight-label", "new-conversation-header", "chat-menu",
    "clear-conversation", "copy-summary", "end-conversation", "current-issue", "handoff-dialog",
    "handoff-close", "handoff-content", "handoff-copy-button", "handoff-copy-status",
    "summary-copy-button", "summary-copy-status",
  ];
  var el = Object.create(null);
  ids.forEach(function (id) { el[id] = byId(id); });

  function setText(node, value) {
    node.textContent = value == null ? "" : String(value);
  }

  function addSectionTitle(parent, text) {
    var title = document.createElement("h3");
    title.className = "section-title";
    setText(title, text);
    parent.append(title);
  }

  function field(text, name) {
    var matcher = new RegExp("^\\s*" + name + "\\s*:\\s*(.*?)\\s*$", "im");
    var match = typeof text === "string" ? text.match(matcher) : null;
    return match ? match[1].trim() : "";
  }

  function issueFromText(text) {
    var value = (text || "").toLocaleLowerCase();
    if (/\bupi\b/.test(value) && /\b(payments?|transaction|transfer)\b/.test(value)) return "UPI payment failure";
    if (/\b(payments?|transaction|transfer)\b/.test(value)) return "Payment failure";
    if (/\b(log ?in|sign ?in|account access)\b/.test(value)) return "Account sign-in issue";
    if (/\b(order|delivery|shipment)\b/.test(value)) return "Order or delivery issue";
    if (/\b(refund|reimbursement)\b/.test(value)) return "Refund issue";
    return "";
  }

  function platformFromText(text) {
    var value = (text || "").toLocaleLowerCase();
    if (/\bandroid\b/.test(value)) return "Android";
    if (/\b(ios|iphone|ipad)\b/.test(value)) return "iOS";
    if (/\b(website|web app|browser)\b/.test(value)) return "Web";
    return "";
  }

  function solutionFromText(text) {
    var value = (text || "").toLocaleLowerCase().replace(/[\u2010-\u2014]/g, "-");
    if (/re[\s-]?auth|reauth|re[\s-]?link/.test(value)) return "Re-authentication or UPI re-linking";
    if (/clear(?:ed|ing)? (?:the )?(?:app )?cache/.test(value)) return "Clear cache";
    if (/reinstall(?:ing)?/.test(value)) return "Reinstall the app";
    if (/restart(?:ing)? (?:the )?(?:app|device|phone)/.test(value)) return "Restart the app or device";
    if (/updat(?:e|ed|ing) (?:the )?app/.test(value)) return "Update the app";
    if (/contact(?:ing)? (?:your )?(?:bank|support)/.test(value)) return "Contact the bank or support";
    return "";
  }

  function outcomeLabel(raw) {
    var value = (raw || "").toString().toLocaleLowerCase();
    if (value === "worked" || value === "success" || value === "successful") return "SUCCESS";
    if (value === "failed" || value === "failure") return "FAILED";
    if (value === "attempted" || value === "tried") return "ATTEMPTED";
    if (value === "advised" || value === "unconfirmed" || value === "customer-confirmed") return "UNCONFIRMED";
    return "";
  }

  function parseMemory(raw) {
    if (typeof raw === "string") raw = { text: raw };
    if (!raw || typeof raw.text !== "string" || !raw.text.trim()) return null;
    var text = raw.text;
    var issue = raw.issue || field(text, "Issue") || issueFromText(text);
    var platform = raw.platform || field(text, "Platform(?:/context)?") || platformFromText(text);
    if (platform === "Not specified") platform = "";
    var solution = raw.solution || field(text, "Solution") || solutionFromText(text);
    if (/no specific solution identified/i.test(solution)) solution = "";
    var status = raw.solution_status || field(text, "Solution status");
    var outcome = outcomeLabel(raw.outcome || field(text, "Outcome"));
    if (!outcome && status) outcome = outcomeLabel(status);
    if (!outcome && /\b(?:advised|recommended|suggested)\b/i.test(text)) outcome = "UNCONFIRMED";
    if (!outcome && solution) outcome = "UNCONFIRMED";
    var customerMessage = raw.customer_message || field(text, "Customer message");
    var recent = customerMessage;
    if (!recent && issue) {
      recent = issue;
      if (solution && outcome) recent += " · " + solution + " — " + outcome.toLocaleLowerCase();
    }
    var timestamp = raw.timestamp || field(text, "Timestamp");
    var timeValue = timestamp ? Date.parse(timestamp) : NaN;
    return { text: text, issue: issue, platform: platform, solution: solution, outcome: outcome, recent: recent, customerMessage: customerMessage, timestamp: Number.isFinite(timeValue) ? timeValue : null };
  }

  function memoryItems() {
    var seen = Object.create(null);
    var result = [];
    var candidates = state.memoryMode === "response"
      ? state.historyMemories.concat(state.recalledMemories)
      : state.historyMemories;
    candidates.forEach(function (raw) {
      var item = parseMemory(raw);
      if (!item) return;
      var key = item.text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (!seen[key]) { seen[key] = true; result.push(item); }
    });
    return result;
  }

  function addFact(parent, label, value) {
    if (!value) return;
    var card = document.createElement("div");
    card.className = "profile-fact";
    var small = document.createElement("small");
    setText(small, label);
    var strong = document.createElement("strong");
    setText(strong, value);
    card.append(small, strong);
    parent.append(card);
  }

  function solutionGroups(items) {
    var groups = Object.create(null);
    items.forEach(function (item, index) {
      if (!item.solution) return;
      var name = solutionFromText(item.solution) || item.solution.trim();
      var key = name.toLocaleLowerCase();
      if (!groups[key]) groups[key] = { name: name, events: [], firstIndex: index };
      var eventIdentity = (item.timestamp !== null ? "at:" + item.timestamp : (item.customerMessage || item.text).toLocaleLowerCase().replace(/\s+/g, " ").trim()) + "|" + (item.outcome || "UNCONFIRMED");
      if (!groups[key].events.some(function (event) { return event.identity === eventIdentity; })) {
        groups[key].events.push({ item: item, identity: eventIdentity, index: index });
      }
    });
    return Object.keys(groups).map(function (key) {
      var group = groups[key];
      group.events.sort(function (a, b) {
        if (a.item.timestamp !== null && b.item.timestamp !== null) return a.item.timestamp - b.item.timestamp;
        if (a.item.timestamp !== null) return 1;
        if (b.item.timestamp !== null) return -1;
        return a.index - b.index;
      });
      group.attemptCount = group.events.length;
      group.latest = group.events[group.events.length - 1] ? group.events[group.events.length - 1].item : null;
      group.hasSuccess = group.events.some(function (event) { return event.item.outcome === "SUCCESS"; });
      group.failedCount = group.events.filter(function (event) { return event.item.outcome === "FAILED"; }).length;
      var lastSuccess = -1;
      group.events.forEach(function (event, index) { if (event.item.outcome === "SUCCESS") lastSuccess = index; });
      group.attemptsSinceSuccess = lastSuccess >= 0 ? group.events.slice(lastSuccess + 1).length : 0;
      return group;
    }).sort(function (a, b) { return a.firstIndex - b.firstIndex; });
  }

  function currentIssueInfo(items) {
    var userMessages = state.active.messages.filter(function (message) { return message.role === "user"; }).map(function (message) { return message.text; });
    var text = userMessages.slice().reverse().find(function (message) { return !!issueFromText(message); }) || "";
    var issue = issueFromText(text);
    if (!issue) {
      for (var i = 0; i < items.length; i += 1) { if (items[i].issue) { issue = items[i].issue; break; } }
    }
    var relatedMessages = issue ? userMessages.filter(function (message) { return issueFromText(message) === issue; }) : userMessages;
    var relatedItems = issue ? items.filter(function (item) { return item.issue === issue; }) : items;
    var source = relatedMessages.concat(relatedItems.map(function (item) { return item.text; })).join("\n");
    var context = [];
    var platform = platformFromText(source);
    if (platform) context.push(platform);
    if (/\bupi\b/i.test(source)) context.push("UPI");
    if (!context.length) {
      items.forEach(function (item) { if (item.platform && context.indexOf(item.platform) < 0) context.push(item.platform); });
    }
    return { issue: issue, context: context };
  }

  function renderCurrentIssue(items) {
    var info = currentIssueInfo(items);
    setText(byId("current-issue-name"), info.issue || "Waiting for issue details");
    setText(byId("current-issue-context"), info.context.length ? info.context.join(" · ") : "Not identified yet");
    var status = state.active.ended ? "Ended" : STATUS_LABELS[state.active.status] || STATUS_LABELS["in-progress"];
    setText(byId("current-issue-status"), status);
    byId("current-issue").dataset.status = state.active.ended ? "ended" : state.active.status;
  }

  function renderMemoryBody(items) {
    el["memory-body"].replaceChildren();
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "memory-empty";
      var icon = document.createElement("span");
      icon.className = "memory-empty-icon";
      icon.setAttribute("aria-hidden", "true");
      setText(icon, "✳");
      var heading = document.createElement("strong");
      setText(heading, "Nothing here yet.");
      var copy = document.createElement("p");
      setText(copy, "As we help, important details and successful solutions will be remembered.");
      empty.append(icon, heading, copy);
      el["memory-body"].append(empty);
      return;
    }

    var context = document.createElement("section");
    context.className = "memory-section";
    addSectionTitle(context, "WHAT I REMEMBER");
    var profile = document.createElement("div");
    profile.className = "profile-grid";
    addFact(profile, "CUSTOMER", displayName(state.currentCustomerId));
    var platforms = [];
    items.forEach(function (item) { if (item.platform && platforms.indexOf(item.platform) < 0) platforms.push(item.platform); });
    var knownContext = platforms.slice();
    if (items.some(function (item) { return /\bupi\b/i.test(item.text); }) && knownContext.indexOf("UPI") < 0) knownContext.push("UPI");
    addFact(profile, "KNOWN CONTEXT", knownContext.join(" · "));
    context.append(profile);
    el["memory-body"].append(context);

    var issues = [];
    items.forEach(function (item) { if (item.issue && issues.indexOf(item.issue) < 0) issues.push(item.issue); });
    if (issues.length) {
      var issueSection = document.createElement("section");
      issueSection.className = "memory-section";
      addSectionTitle(issueSection, "PREVIOUS ISSUES");
      var issueList = document.createElement("div");
      issueList.className = "history-list";
      issues.slice(0, 5).forEach(function (issue) {
        var row = document.createElement("div"); row.className = "history-item"; setText(row, issue); issueList.append(row);
      });
      issueSection.append(issueList); el["memory-body"].append(issueSection);
    }

    var solutions = solutionGroups(items);
    if (solutions.length) {
      var solutionSection = document.createElement("section");
      solutionSection.className = "memory-section";
      addSectionTitle(solutionSection, "SOLUTIONS TRIED");
      var solutionList = document.createElement("div"); solutionList.className = "solution-list";
      solutions.forEach(function (solution) {
        var row = document.createElement("div"); row.className = "solution-item";
        var outcome = solution.latest ? solution.latest.outcome || "UNCONFIRMED" : "UNCONFIRMED";
        var mark = document.createElement("span"); mark.className = "solution-mark"; mark.dataset.outcome = outcome;
        setText(mark, outcome === "SUCCESS" ? "✓" : outcome === "FAILED" ? "×" : "·");
        var copy = document.createElement("span"); copy.className = "solution-copy";
        var name = document.createElement("strong"); setText(name, solution.name);
        var badge = document.createElement("span"); badge.className = "outcome-badge"; badge.dataset.outcome = outcome;
        setText(badge, solution.hasSuccess && outcome === "FAILED" ? "SUCCESSFUL PREVIOUSLY" : outcome === "SUCCESS" ? "SUCCESSFUL PREVIOUSLY" : outcome);
        var count = document.createElement("small"); count.className = "solution-attempt-count";
        var detail = solution.attemptCount + (solution.attemptCount === 1 ? " recorded attempt" : " recorded attempts");
        if (solution.attemptsSinceSuccess > 0) detail += " · " + solution.attemptsSinceSuccess + " since success";
        count.textContent = detail;
        var latest = document.createElement("small"); latest.className = "solution-latest"; latest.textContent = "Latest: " + outcome;
        copy.append(name, badge, count, latest); row.append(mark, copy); solutionList.append(row);
      });
      solutionSection.append(solutionList); el["memory-body"].append(solutionSection);
    }

    var issueCount = Object.create(null);
    items.forEach(function (item) { if (item.issue) issueCount[item.issue] = (issueCount[item.issue] || 0) + 1; });
    var currentIssue = currentIssueInfo(items).issue;
    var currentMessages = state.active.messages.filter(function (message) { return message.role === "user"; });
    var recurrenceMentioned = currentMessages.some(function (message) { return /\b(?:again|recurr(?:ing|ed)?|still)\b/i.test(message.text); });
    var recurring = currentIssue && (issueCount[currentIssue] > 1 || recurrenceMentioned);
    if (currentIssue) {
      var statusSection = document.createElement("section"); statusSection.className = "memory-section";
      addSectionTitle(statusSection, "CURRENT STATUS");
      var statusRow = document.createElement("div"); statusRow.className = "memory-status-summary";
      setText(statusRow, recurring ? "Recurring issue" : "Issue recorded in history");
      statusSection.append(statusRow); el["memory-body"].append(statusSection);
    }

    var recent = items.slice().sort(function (a, b) {
      if (a.timestamp !== null && b.timestamp !== null) return b.timestamp - a.timestamp;
      if (a.timestamp !== null) return -1;
      if (b.timestamp !== null) return 1;
      return 0;
    }).filter(function (item) { return !!item.recent; });
    if (recent.length) {
      var activity = document.createElement("section"); activity.className = "memory-section";
      var details = document.createElement("details"); details.className = "memory-activity-details";
      var summary = document.createElement("summary"); setText(summary, "Recent activity · " + recent.length); details.append(summary);
      var activityList = document.createElement("div"); activityList.className = "history-list";
      recent.slice(0, 8).forEach(function (item) { var row = document.createElement("div"); row.className = "history-item"; setText(row, item.recent + (item.solution && item.outcome ? " · " + item.solution + " — " + item.outcome : "")); activityList.append(row); });
      details.append(activityList); activity.append(details); el["memory-body"].append(activity);
    }
  }

  function renderMemories() {
    var items = memoryItems();
    var active = state.active;
    var count = state.memoryMode === "response" ? state.recalledMemories.length : state.historyMemories.length;
    setText(el["memory-count"], count);
    var kind = state.memoryLoading || active.loading ? "loading" : state.memoryError ? "error" : count ? "ready" : "empty";
    el["memory-status"].dataset.kind = kind;

    if (state.memoryLoading) {
      setText(el["memory-status-title"], "Loading Hindsight history…");
      setText(el["memory-status-copy"], "Finding support details for " + displayName(state.currentCustomerId) + ".");
    } else if (active.loading) {
      setText(el["memory-status-title"], "Recalling customer history…");
      setText(el["memory-status-copy"], "Hindsight context is being sent with this message to the support agent.");
    } else if (state.memoryError) {
      setText(el["memory-status-title"], "Hindsight history unavailable");
      setText(el["memory-status-copy"], "This customer’s history could not be loaded. Retry when ready.");
    } else if (state.memoryMode === "response") {
      setText(el["memory-status-title"], count + (count === 1 ? " relevant memory recalled" : " relevant memories recalled"));
      var responseCopy = count
        ? "These are the Hindsight memories returned for the latest reply."
        : "No previous memories were returned; the agent answered without claiming to remember.";
      if (state.memoryUpdateError) responseCopy += " A useful update could not be saved.";
      setText(el["memory-status-copy"], responseCopy);
    } else if (count) {
      setText(el["memory-status-title"], count + (count === 1 ? " memory in Hindsight" : " memories in Hindsight"));
      setText(el["memory-status-copy"], "Private support history for " + displayName(state.currentCustomerId) + ".");
    } else {
      setText(el["memory-status-title"], "No previous history yet");
      setText(el["memory-status-copy"], "Important details and successful solutions will be remembered as we help.");
    }
    el["memory-retry"].hidden = !state.memoryError;
    setText(el["memory-footnote-copy"], state.memoryMode === "response"
      ? "The count above is the actual Hindsight recall returned for this response."
      : "Only this customer’s Hindsight memories are shown.");
    renderMemoryBody(items);
    renderCurrentIssue(items);
    var serviceState = state.memoryAvailable === null ? "loading" : state.memoryAvailable ? "ready" : "error";
    el["hindsight-indicator"].dataset.state = serviceState;
    setText(el["hindsight-label"], serviceState === "loading" ? "Connecting to Hindsight…" : serviceState === "ready" ? "Hindsight Memory Active" : "Hindsight unavailable");
  }

  function renderCustomers() {
    el["customer-list"].replaceChildren();
    state.customers.forEach(function (id) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "customer-item" + (canonicalId(id) === canonicalId(state.currentCustomerId) ? " active" : "");
      button.setAttribute("aria-current", canonicalId(id) === canonicalId(state.currentCustomerId) ? "true" : "false");
      var avatar = document.createElement("span"); avatar.className = "small-avatar"; avatar.setAttribute("aria-hidden", "true"); setText(avatar, displayName(id).charAt(0).toLocaleUpperCase());
      var copy = document.createElement("span"); copy.className = "customer-copy";
      var name = document.createElement("strong"); setText(name, displayName(id));
      var identity = document.createElement("small"); setText(identity, id);
      copy.append(name, identity);
      var dot = document.createElement("i"); dot.className = "active-dot"; dot.setAttribute("aria-hidden", "true");
      button.append(avatar, copy, dot);
      button.addEventListener("click", function () { selectCustomer(id); });
      el["customer-list"].append(button);
    });
    setText(el["customer-total"], state.customers.length);
    el["new-customer-form"].hidden = !state.creatingCustomer;
    el["new-customer-button"].setAttribute("aria-expanded", String(state.creatingCustomer));
    if (el["new-customer-id"].value !== state.customerDraft) el["new-customer-id"].value = state.customerDraft;
  }

  function renderStatus() {
    var thread = state.active;
    var status = thread.ended ? "ended" : thread.status;
    setText(el["conversation-status"], STATUS_LABELS[status] || STATUS_LABELS["in-progress"]);
    el["conversation-status"].dataset.status = status;
    setText(el["conversation-heading"], displayName(state.currentCustomerId));
    setText(el["customer-avatar"], displayName(state.currentCustomerId).charAt(0).toLocaleUpperCase());
  }

  function copyText(value) {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return false; });
    }
    var field = document.createElement("textarea");
    field.value = value; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select();
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (error) { copied = false; }
    field.remove();
    return Promise.resolve(copied);
  }

  function conversationItems(items) {
    var result = items.slice();
    state.active.messages.forEach(function (message) {
      if (message.role !== "user" || !message.reportedSolution || !message.reportedOutcome) return;
      var alreadyRemembered = result.some(function (item) {
        return (item.customerMessage || "").trim().toLocaleLowerCase() === message.text.trim().toLocaleLowerCase() &&
          item.solution && item.solution.toLocaleLowerCase() === message.reportedSolution.toLocaleLowerCase() &&
          item.outcome === message.reportedOutcome;
      });
      if (alreadyRemembered) return;
      result.push({ text: message.text, issue: issueFromText(message.text), platform: platformFromText(message.text), solution: message.reportedSolution, outcome: message.reportedOutcome, customerMessage: message.text, timestamp: message.createdAt ? Date.parse(message.createdAt) : null });
    });
    return result;
  }

  function shouldEscalate(items) {
    var explicit = state.active.messages.some(function (message) {
      return message.role === "user" && /\b(?:still need help|still need support|need more help|need a person|speak to (?:a )?human|talk to (?:a )?person|please escalate|escalate this)\b/i.test(message.text);
    });
    if (explicit) return true;
    var groups = solutionGroups(conversationItems(items));
    var failedGroups = groups.filter(function (group) { return group.failedCount > 0; });
    return failedGroups.length >= 2 || failedGroups.some(function (group) { return group.failedCount >= 2 && group.latest && group.latest.outcome === "FAILED"; });
  }

  function handoffText(items) {
    var allItems = conversationItems(items);
    var info = currentIssueInfo(allItems);
    var groups = solutionGroups(allItems);
    var lines = [
      "SUPPORT HANDOFF",
      "Customer: " + displayName(state.currentCustomerId),
      "Issue: " + (info.issue || "Not identified yet"),
      "Environment: " + (info.context.length ? info.context.join(" / ") : "Not identified yet"),
      "Troubleshooting:",
    ];
    if (groups.length) {
      groups.forEach(function (group) {
        var latest = group.latest ? group.latest.outcome || "UNCONFIRMED" : "UNCONFIRMED";
        lines.push("- " + group.name + " — " + latest + " (" + group.attemptCount + (group.attemptCount === 1 ? " recorded attempt" : " recorded attempts") + ")");
      });
    } else lines.push("- No specific troubleshooting step was identified.");
    var previousSuccesses = groups.filter(function (group) { return group.hasSuccess && group.latest && group.latest.outcome === "FAILED"; });
    if (previousSuccesses.length) {
      lines.push("Relevant previous history:");
      previousSuccesses.forEach(function (group) { lines.push("- " + group.name + " was successful previously; the latest reported result is FAILED."); });
    }
    lines.push("Current status: UNRESOLVED");
    return lines.join("\n");
  }

  function openHandoff() {
    var items = uniqueItems(state.historyMemories.concat(state.recalledMemories));
    setText(el["handoff-content"], handoffText(items));
    setText(el["handoff-copy-status"], "");
    if (typeof el["handoff-dialog"].showModal === "function") el["handoff-dialog"].showModal();
    else el["handoff-dialog"].setAttribute("open", "");
  }

  function renderEscalation(items) {
    var existing = el.conversation.querySelector(".escalation-card");
    if (existing) existing.remove();
    if (!shouldEscalate(items) || state.active.ended || state.active.loading) return;
    var card = document.createElement("section"); card.className = "escalation-card"; card.setAttribute("aria-label", "Human support handoff");
    var copy = document.createElement("div");
    var title = document.createElement("strong"); setText(title, "Still having trouble?");
    var note = document.createElement("p"); setText(note, "Prepare a summary to share with human support. No ticket is created.");
    copy.append(title, note);
    var button = document.createElement("button"); button.type = "button"; button.className = "button button-primary"; setText(button, "Escalate to Support");
    button.addEventListener("click", openHandoff);
    card.append(copy, button); el.conversation.append(card);
  }

  function appendInlineText(parent, text) {
    var pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    var cursor = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) {
        var plain = document.createElement("span");
        setText(plain, text.slice(cursor, match.index));
        parent.append(plain);
      }
      var formatted = document.createElement(match[1] ? "strong" : "code");
      setText(formatted, match[1] || match[2]);
      parent.append(formatted);
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length || !text.length) {
      var tail = document.createElement("span");
      setText(tail, text.slice(cursor));
      parent.append(tail);
    }
  }

  function appendFormattedText(parent, text) {
    var lines = (text || "").split(/\r?\n/);
    var paragraph = [];
    var list = null;
    function flushParagraph() {
      if (!paragraph.length) return;
      var p = document.createElement("p"); appendInlineText(p, paragraph.join(" ")); parent.append(p); paragraph = [];
    }
    function flushList() { if (list) { parent.append(list); list = null; } }
    lines.forEach(function (line) {
      var bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!list) list = document.createElement("ul");
        var li = document.createElement("li"); appendInlineText(li, bullet[1]); list.append(li);
      } else if (!line.trim()) {
        flushParagraph(); flushList();
      } else {
        flushList(); paragraph.push(line.trim());
      }
    });
    flushParagraph(); flushList();
  }

  function outcomeQuickActions(solution) {
    var actions = [
      { label: "I tried this", status: "attempted", message: "I tried " + solution + ", but I don’t know the result yet." },
      { label: "It worked", status: "success", message: "I tried " + solution + " and it worked." },
      { label: "It didn’t work", status: "failed", message: "I tried " + solution + ", but it didn’t work." },
    ];
    var group = document.createElement("div"); group.className = "quick-actions"; group.setAttribute("aria-label", "Report the result of the suggested solution");
    actions.forEach(function (action) {
      var button = document.createElement("button"); button.type = "button"; button.className = "quick-action"; setText(button, action.label);
      button.disabled = state.active.loading || state.active.ended;
      button.addEventListener("click", function () {
        sendMessage(action.message, { status: action.status, solution: solution }, false);
      });
      group.append(button);
    });
    return group;
  }

  function questionQuickActions() {
    var group = document.createElement("div"); group.className = "quick-actions"; group.setAttribute("aria-label", "Reply to the agent’s question");
    [
      { label: "I’ll provide it", value: "I’ll provide those details." },
      { label: "That’s not the issue", value: "That’s not the issue I’m experiencing." },
    ].forEach(function (action) {
      var button = document.createElement("button"); button.type = "button"; button.className = "quick-action"; setText(button, action.label);
      button.addEventListener("click", function () {
        state.draft = action.value;
        el["message-input"].value = state.draft;
        el["message-input"].focus();
      });
      group.append(button);
    });
    return group;
  }

  function renderMessage(item) {
    var isUser = item.role === "user";
    var row = document.createElement("article"); row.className = "message-row " + (isUser ? "user" : "assistant");
    var avatar = document.createElement("span"); avatar.className = "message-avatar"; avatar.setAttribute("aria-hidden", "true"); setText(avatar, isUser ? displayName(state.currentCustomerId).charAt(0).toLocaleUpperCase() : "S");
    var content = document.createElement("div"); content.className = "message-content";
    var meta = document.createElement("div"); meta.className = "message-meta";
    var name = document.createElement("strong"); setText(name, isUser ? displayName(state.currentCustomerId) : "SupportAI");
    var time = document.createElement("time");
    if (item.createdAt) time.dateTime = item.createdAt;
    setText(time, item.time || nowTime());
    meta.append(name, time);
    var bubble = document.createElement("div"); bubble.className = "bubble"; appendFormattedText(bubble, item.text);
    content.append(meta, bubble);

    if (!isUser && (Number.isInteger(item.memoryCount) || item.memoryUpdated || item.memoryUpdateError)) {
      var note = document.createElement("div"); note.className = "message-note";
      if (Number.isInteger(item.memoryCount)) {
        var recalled = document.createElement("span"); setText(recalled, item.memoryCount + (item.memoryCount === 1 ? " Hindsight memory recalled" : " Hindsight memories recalled")); note.append(recalled);
      }
      if (item.memoryUpdated) {
        var saved = document.createElement("span"); saved.className = "memory-saved"; setText(saved, "✓ Memory updated"); note.append(saved);
      } else if (item.memoryUpdateError) {
        var notSaved = document.createElement("span"); notSaved.className = "memory-no-save"; setText(notSaved, "Memory could not be updated"); note.append(notSaved);
      }
      content.append(note);
    }

    if (isUser) { row.append(content, avatar); } else { row.append(avatar, content); }

    if (!isUser) {
      var controls = document.createElement("div"); controls.className = "response-controls";
      var copyButton = document.createElement("button"); copyButton.type = "button"; copyButton.className = "copy-response"; setText(copyButton, item.copied ? "Copied" : "Copy");
      copyButton.setAttribute("aria-label", item.copied ? "Response copied" : "Copy response");
      copyButton.addEventListener("click", function () {
        copyText(item.text).then(function (copied) {
          if (!copied) { setText(copyButton, "Copy failed"); return; }
          item.copied = true; setText(copyButton, "Copied");
          window.setTimeout(function () { item.copied = false; if (copyButton.isConnected) setText(copyButton, "Copy"); }, 1800);
        });
      });
      controls.append(copyButton); content.append(controls);
      if (item.suggestedSolution) content.append(outcomeQuickActions(item.suggestedSolution));
      else if (item.canClarify) content.append(questionQuickActions());
    }
    return row;
  }

  function renderPending() {
    var row = document.createElement("article"); row.className = "message-row assistant pending";
    var avatar = document.createElement("span"); avatar.className = "message-avatar"; avatar.setAttribute("aria-hidden", "true"); setText(avatar, "S");
    var content = document.createElement("div"); content.className = "message-content";
    var meta = document.createElement("div"); meta.className = "message-meta";
    var name = document.createElement("strong"); setText(name, "SupportAI");
    var time = document.createElement("time"); setText(time, nowTime()); meta.append(name, time);
    var bubble = document.createElement("div"); bubble.className = "bubble"; bubble.setAttribute("role", "status");
    var dots = document.createElement("span"); dots.className = "typing-dots"; dots.setAttribute("aria-hidden", "true");
    setText(bubble, "Recalling customer history and preparing a response"); bubble.append(dots);
    content.append(meta, bubble); row.append(avatar, content); return row;
  }

  function renderResolutionCard() {
    var card = document.createElement("section"); card.className = "resolution-card"; card.setAttribute("aria-label", "Issue resolved");
    var heading = document.createElement("div"); heading.className = "resolution-heading";
    var icon = document.createElement("span"); setText(icon, "✓"); var title = document.createElement("strong"); setText(title, "Issue resolved"); heading.append(icon, title);
    var copy = document.createElement("p"); setText(copy, "Glad we could get this sorted out. Would you like to continue chatting or end this conversation?");
    var actions = document.createElement("div"); actions.className = "resolution-actions";
    var continueButton = document.createElement("button"); continueButton.type = "button"; continueButton.className = "button button-quiet"; setText(continueButton, "Continue chat");
    continueButton.addEventListener("click", function () { state.active.resolutionPrompt = false; state.active.status = "in-progress"; render(); el["message-input"].focus(); });
    var endButton = document.createElement("button"); endButton.type = "button"; endButton.className = "button button-primary"; setText(endButton, "End chat");
    endButton.addEventListener("click", endConversation);
    actions.append(continueButton, endButton); card.append(heading, copy, actions); return card;
  }

  function renderConversation() {
    var thread = state.active;
    var oldHeight = el.conversation.scrollHeight || 0;
    var oldTop = el.conversation.scrollTop || 0;
    var viewport = el.conversation.clientHeight || 0;
    var nearBottom = oldHeight - (oldTop + viewport) <= 90;
    el.conversation.replaceChildren();
    if (!thread.messages.length) {
      var empty = document.createElement("div"); empty.className = "empty-chat";
      var icon = document.createElement("span"); icon.className = "empty-chat-icon"; icon.setAttribute("aria-hidden", "true"); setText(icon, "✳");
      var heading = document.createElement("h3"); setText(heading, "Start a conversation");
      var copy = document.createElement("p"); setText(copy, "Tell me what you’re experiencing.");
      empty.append(icon, heading, copy); el.conversation.append(empty);
    } else {
      var previousDate = "";
      thread.messages.forEach(function (message) {
        var key = dateKey(message.createdAt);
        if (key !== previousDate) {
          var separator = document.createElement("div"); separator.className = "date-separator";
          var label = document.createElement("span"); setText(label, dateLabel(message.createdAt)); separator.append(label); el.conversation.append(separator);
          previousDate = key;
        }
        el.conversation.append(renderMessage(message));
      });
    }
    if (thread.loading) el.conversation.append(renderPending());
    if (thread.resolutionPrompt && !thread.ended) el.conversation.append(renderResolutionCard());
    var memories = memoryItems();
    renderEscalation(memories);
    if (thread.error) {
      var notice = document.createElement("div"); notice.className = "chat-error"; notice.setAttribute("role", "alert");
      var errorCopy = document.createElement("span"); setText(errorCopy, thread.error); notice.append(errorCopy);
      if (thread.lastFailedMessage) {
        var retry = document.createElement("button"); retry.type = "button"; retry.className = "button button-quiet"; setText(retry, "Retry");
        retry.addEventListener("click", function () { if (!thread.loading) sendMessage(thread.lastFailedMessage, thread.lastFailedOutcome, true); });
        notice.append(retry);
      }
      el.conversation.append(notice);
    }
    if (thread.localNotice) {
      var system = document.createElement("div"); system.className = "system-notice"; system.setAttribute("role", "status"); setText(system, thread.localNotice); el.conversation.append(system);
    }
    if (thread.ended) {
      var ended = document.createElement("section"); ended.className = "ended-thread-notice";
      var endedTitle = document.createElement("strong"); setText(endedTitle, "Conversation ended");
      var endedCopy = document.createElement("p"); setText(endedCopy, "Thank you for chatting with SupportAI. Your history has been saved.");
      var start = document.createElement("button"); start.type = "button"; start.className = "button button-primary"; setText(start, "Start new conversation"); start.disabled = thread.loading; start.addEventListener("click", newConversation);
      ended.append(endedTitle, endedCopy, start); el.conversation.append(ended);
    }
    if (nearBottom) el.conversation.scrollTop = el.conversation.scrollHeight;
    else el.conversation.scrollTop = oldTop;

    el["message-input"].value = state.draft;
    el["message-input"].disabled = thread.loading || thread.ended;
    el["send-button"].disabled = thread.loading || thread.ended;
    setText(el["send-label"], thread.loading ? "Sending…" : "Send");
    el["new-conversation"].disabled = thread.loading;
    el["new-conversation-header"].disabled = thread.loading;
    el["clear-conversation"].disabled = thread.loading;
    el["end-conversation"].disabled = thread.loading || thread.ended;
    el.feedback.hidden = !thread.ended;
    var feedbackButtons = el.feedback.querySelectorAll("button[data-feedback]");
    feedbackButtons.forEach(function (button) { button.hidden = !!thread.feedback; });
    el["feedback-thanks"].hidden = !thread.feedback;
  }

  function renderDrawer() {
    var open = state.memoryDrawerOpen;
    el["memory-panel"].classList.toggle("is-open", open);
    el["memory-scrim"].hidden = !open;
    el["memory-toggle"].setAttribute("aria-expanded", String(open));
  }

  function render() {
    renderCustomers();
    renderStatus();
    renderConversation();
    renderMemories();
    renderDrawer();
  }

  function abort(controller) { if (controller) controller.abort(); }

  function loadCustomerMemories(customerId, generation, background) {
    abort(state.memoryController);
    var controller = new AbortController();
    state.memoryController = controller;
    if (!background) {
      state.memoryLoading = true;
      state.memoryError = false;
      state.memoryAvailable = null;
      state.memoryMode = "history";
      state.historyMemories = [];
      state.recalledMemories = [];
      render();
    }
    fetch("/customers/" + encodeURIComponent(customerId) + "/memories", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !Array.isArray(data.memories)) throw new Error("history");
        return data;
      });
    }).then(function (data) {
      if (generation !== state.generation || customerId !== state.currentCustomerId) return;
      state.memoryLoading = false;
      state.memoryError = false;
      state.memoryAvailable = true;
      state.historyMemories = data.memories;
      render();
    }).catch(function () {
      if (generation !== state.generation || customerId !== state.currentCustomerId) return;
      if (!background) {
        state.memoryLoading = false;
        state.memoryError = true;
        state.memoryAvailable = false;
        render();
      } else {
        console.warn("Hindsight history refresh failed after the support response.");
      }
    });
  }

  function selectCustomer(value) {
    var next = typeof value === "string" ? value.trim() : "";
    if (!next || next.length > 128) return;
    var existing = state.customers.find(function (id) { return canonicalId(id) === canonicalId(next); });
    if (existing) next = existing;
    if (canonicalId(next) === canonicalId(state.currentCustomerId)) {
      state.creatingCustomer = false; state.customerDraft = ""; render(); return;
    }

    if (state.active.loading) {
      state.active.lastFailedMessage = state.active.pendingMessage;
      state.active.lastFailedOutcome = state.active.pendingOutcome;
      state.active.loading = false;
      state.active.error = "This request was canceled when you switched customers. You can retry it here.";
    }
    state.generation += 1;
    state.sequence += 1;
    abort(state.chatController);
    abort(state.memoryController);
    state.chatController = null;
    state.memoryController = null;
    state.currentCustomerId = next;
    var key = canonicalId(next);
    if (state.customers.every(function (id) { return canonicalId(id) !== key; })) state.customers.push(next);
    state.active = state.conversations[key] || makeConversation();
    state.conversations[key] = state.active;
    state.creatingCustomer = false;
    state.customerDraft = "";
    state.draft = "";
    state.memoryLoading = false;
    state.memoryError = false;
    state.memoryAvailable = null;
    state.memoryUpdateError = false;
    state.memoryMode = "history";
    state.historyMemories = [];
    state.recalledMemories = [];
    state.memoryDrawerOpen = false;
    render();
    loadCustomerMemories(next, state.generation, false);
  }

  function retryMemoryLoad() {
    state.generation += 1;
    abort(state.memoryController);
    state.memoryError = false;
    state.memoryLoading = false;
    render();
    loadCustomerMemories(state.currentCustomerId, state.generation, false);
  }

  function requestIsCurrent(customerId, generation, sequence, thread) {
    return generation === state.generation && sequence === state.sequence &&
      canonicalId(customerId) === canonicalId(state.currentCustomerId) && thread === state.active;
  }

  function statusFromOutcome(outcome) {
    if (outcome === "SUCCESS") return "resolved";
    if (outcome === "FAILED") return "needs-attention";
    if (outcome === "ATTEMPTED" || outcome === "UNCONFIRMED") return "in-progress";
    return "";
  }

  function isQuestionForDetails(text) {
    return /\?\s*$/.test(text || "") && /\b(could you|can you|what|which|tell me|share|confirm|let me know)\b/i.test(text || "");
  }

  function responseReceived(data, customerId, generation, sequence, thread) {
    if (!requestIsCurrent(customerId, generation, sequence, thread)) return;
    var reportedOutcome = thread.pendingOutcome;
    thread.loading = false;
    thread.error = "";
    thread.localNotice = "";
    thread.lastFailedMessage = "";
    thread.lastFailedOutcome = null;
    thread.pendingMessage = "";
    thread.pendingOutcome = null;
    state.memoryLoading = false;
    state.memoryError = false;
    state.memoryAvailable = true;
    state.memoryMode = "response";
    state.memoryUpdateError = data.memory_update_error === true;
    state.recalledMemories = Array.isArray(data.memories) ? data.memories : [];
    var outcome = typeof data.outcome === "string" ? data.outcome.toLocaleUpperCase() : "";
    var nextStatus = statusFromOutcome(outcome);
    if (nextStatus) thread.status = nextStatus;
    if (outcome === "SUCCESS") thread.resolutionPrompt = true;
    var lastCustomerMessage = thread.messages.slice().reverse().find(function (message) { return message.role === "user"; });
    if (lastCustomerMessage) {
      var naturalSolution = solutionFromText(lastCustomerMessage.text);
      if (reportedOutcome && reportedOutcome.solution) {
        lastCustomerMessage.reportedSolution = reportedOutcome.solution;
        lastCustomerMessage.reportedOutcome = outcomeLabel(reportedOutcome.status);
      } else if (naturalSolution && ["SUCCESS", "FAILED", "ATTEMPTED", "UNCONFIRMED"].indexOf(outcome) >= 0) {
        lastCustomerMessage.reportedSolution = naturalSolution;
        lastCustomerMessage.reportedOutcome = outcome || "UNCONFIRMED";
      }
    }
    var assistantMessage = {
      role: "assistant",
      text: data.response,
      time: nowTime(),
      createdAt: new Date().toISOString(),
      memoryCount: state.recalledMemories.length,
      memoryUpdated: data.memory_updated === true,
      memoryUpdateError: data.memory_update_error === true,
      suggestedSolution: typeof data.suggested_solution === "string" ? data.suggested_solution : "",
      canClarify: !data.suggested_solution && isQuestionForDetails(data.response),
    };
    thread.messages.push(assistantMessage);
    render();
    if (data.memory_updated === true || data.memory_update_error === true) {
      loadCustomerMemories(customerId, generation, true);
    }
  }

  function requestFailed(customerId, generation, sequence, thread, message, outcome) {
    if (!requestIsCurrent(customerId, generation, sequence, thread)) return;
    thread.loading = false;
    thread.error = "Something went wrong while contacting the support agent. Please try again.";
    thread.lastFailedMessage = message;
    thread.lastFailedOutcome = outcome;
    thread.pendingMessage = "";
    thread.pendingOutcome = null;
    state.memoryLoading = false;
    state.memoryMode = "history";
    console.warn("Support request failed; technical details are available in the Flask log.");
    render();
  }

  function sendMessage(text, outcome, retry) {
    var customerId = state.currentCustomerId;
    var message = typeof text === "string" ? text.trim() : "";
    var thread = state.active;
    if (!customerId || thread.ended || thread.loading) return;
    if (!message) { el["message-input"].focus(); return; }
    if (message.length > 4000) {
      thread.error = "Messages must be 4,000 characters or fewer."; render(); return;
    }
    thread.error = "";
    if (!retry) {
      var userMessage = { role: "user", text: message, time: nowTime(), createdAt: new Date().toISOString() };
      if (outcome && outcome.solution) {
        userMessage.reportedSolution = outcome.solution;
        userMessage.reportedOutcome = outcomeLabel(outcome.status);
      }
      thread.messages.push(userMessage);
    }
    state.draft = "";
    thread.loading = true;
    thread.pendingMessage = message;
    thread.pendingOutcome = outcome || null;
    state.memoryMode = "pending";
    state.memoryUpdateError = false;
    state.sequence += 1;
    var sequence = state.sequence;
    var generation = state.generation;
    var controller = new AbortController();
    state.chatController = controller;
    var body = { customer_id: customerId, message: message };
    if (outcome) body.outcome = outcome;
    render();

    fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || typeof data.response !== "string") throw new Error("chat");
        return data;
      });
    }).then(function (data) {
      responseReceived(data, customerId, generation, sequence, thread);
    }).catch(function () {
      requestFailed(customerId, generation, sequence, thread, message, outcome || null);
    });
  }

  function endConversation() {
    if (state.active.loading) return;
    state.active.ended = true;
    state.active.status = "ended";
    state.active.resolutionPrompt = false;
    state.active.localNotice = "";
    render();
  }

  function clearCurrentConversation() {
    if (state.active.loading) return;
    var fresh = makeConversation();
    fresh.localNotice = "Conversation cleared. Hindsight customer history remains available.";
    state.conversations[canonicalId(state.currentCustomerId)] = fresh;
    state.active = fresh;
    state.draft = "";
    state.memoryMode = "history";
    state.memoryUpdateError = false;
    state.generation += 1;
    abort(state.memoryController);
    state.historyMemories = [];
    state.recalledMemories = [];
    render();
    loadCustomerMemories(state.currentCustomerId, state.generation, false);
  }

  function newConversation() {
    if (state.active.loading) return;
    var fresh = makeConversation();
    state.conversations[canonicalId(state.currentCustomerId)] = fresh;
    state.active = fresh;
    state.draft = "";
    state.memoryMode = "history";
    state.memoryUpdateError = false;
    state.generation += 1;
    abort(state.memoryController);
    render();
    loadCustomerMemories(state.currentCustomerId, state.generation, false);
    el["message-input"].focus();
  }

  function uniqueItems(memories) {
    var seen = Object.create(null); var result = [];
    (memories || []).forEach(function (raw) {
      var item = parseMemory(raw); if (!item) return;
      var key = item.text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      if (!seen[key]) { seen[key] = true; result.push(item); }
    });
    return result;
  }

  function addSummaryRow(label, content, list) {
    var section = document.createElement("section"); section.className = "summary-row";
    var heading = document.createElement("h3"); setText(heading, label.toLocaleUpperCase()); section.append(heading);
    if (list && list.length) {
      var ul = document.createElement("ul");
      list.forEach(function (item) { var li = document.createElement("li"); setText(li, item); ul.append(li); });
      section.append(ul);
    } else {
      var p = document.createElement("p"); setText(p, content || "Not identified in this conversation or Hindsight history."); section.append(p);
    }
    el["summary-content"].append(section);
  }

  function summaryData() {
    var items = uniqueItems(state.historyMemories.concat(state.recalledMemories));
    var allItems = conversationItems(items);
    var info = currentIssueInfo(allItems);
    var groups = solutionGroups(allItems);
    var attempts = groups.map(function (group) {
      var latest = group.latest ? group.latest.outcome || "UNCONFIRMED" : "UNCONFIRMED";
      return group.name + " — " + latest + " (" + group.attemptCount + (group.attemptCount === 1 ? " attempt" : " attempts") + ")";
    });
    return {
      customer: displayName(state.currentCustomerId),
      issue: info.issue || "No issue identified yet.",
      environment: info.context.length ? info.context.join(" · ") : "Not identified yet.",
      attempts: attempts,
      outcomes: groups.map(function (group) { return group.name + ": " + (group.latest ? group.latest.outcome || "UNCONFIRMED" : "UNCONFIRMED"); }),
      status: state.active.ended ? "Ended" : STATUS_LABELS[state.active.status] || "In Progress",
    };
  }

  function summaryPlainText() {
    var data = summaryData();
    return [
      "CONVERSATION SUMMARY",
      "Customer: " + data.customer,
      "Issue: " + data.issue,
      "Environment: " + data.environment,
      "What was tried: " + (data.attempts.length ? "\n- " + data.attempts.join("\n- ") : "Not identified yet."),
      "Outcomes: " + (data.outcomes.length ? "\n- " + data.outcomes.join("\n- ") : "Not identified yet."),
      "Current status: " + data.status,
    ].join("\n");
  }

  function openSummary() {
    var data = summaryData();
    el["summary-content"].replaceChildren();
    addSummaryRow("Customer", data.customer);
    addSummaryRow("Issue", data.issue);
    addSummaryRow("Environment", data.environment);
    addSummaryRow("What was tried", "", data.attempts);
    addSummaryRow("Outcomes", "", data.outcomes);
    addSummaryRow("Current status", data.status);
    setText(el["summary-copy-status"], "");
    if (typeof el["summary-dialog"].showModal === "function") el["summary-dialog"].showModal();
    else el["summary-dialog"].setAttribute("open", "");
  }

  el["new-customer-button"].addEventListener("click", function () {
    state.creatingCustomer = !state.creatingCustomer;
    state.customerDraft = "";
    renderCustomers();
    if (state.creatingCustomer) el["new-customer-id"].focus();
  });
  el["new-customer-id"].addEventListener("input", function (event) { state.customerDraft = event.target.value; });
  el["cancel-new-customer"].addEventListener("click", function () { state.creatingCustomer = false; state.customerDraft = ""; render(); });
  el["new-customer-form"].addEventListener("submit", function (event) {
    event.preventDefault();
    var value = state.customerDraft.trim();
    if (!value || value.length > 128) {
      state.active.error = "Enter a customer name or ID between 1 and 128 characters."; render(); el["new-customer-id"].focus(); return;
    }
    selectCustomer(value);
  });
  el["message-input"].addEventListener("input", function (event) { state.draft = event.target.value; });
  el["message-form"].addEventListener("submit", function (event) { event.preventDefault(); sendMessage(state.draft, null, false); });
  el["message-input"].addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); el["message-form"].requestSubmit(); }
  });
  el["memory-retry"].addEventListener("click", retryMemoryLoad);
  el["new-conversation"].addEventListener("click", newConversation);
  el["new-conversation-header"].addEventListener("click", newConversation);
  el["clear-conversation"].addEventListener("click", function () { el["chat-menu"].removeAttribute("open"); clearCurrentConversation(); });
  el["copy-summary"].addEventListener("click", function () {
    el["chat-menu"].removeAttribute("open");
    copyText(summaryPlainText()).then(function (copied) {
      state.active.localNotice = copied ? "Conversation summary copied." : "Could not copy the summary. Try the Summary window.";
      renderConversation();
    });
  });
  el["end-conversation"].addEventListener("click", function () { el["chat-menu"].removeAttribute("open"); endConversation(); });
  el["summary-button"].addEventListener("click", openSummary);
  el["summary-copy-button"].addEventListener("click", function () {
    copyText(summaryPlainText()).then(function (copied) { setText(el["summary-copy-status"], copied ? "Summary copied." : "Copy failed."); });
  });
  el["summary-close"].addEventListener("click", function () {
    if (typeof el["summary-dialog"].close === "function") el["summary-dialog"].close();
    else el["summary-dialog"].removeAttribute("open");
  });
  el["handoff-close"].addEventListener("click", function () {
    if (typeof el["handoff-dialog"].close === "function") el["handoff-dialog"].close();
    else el["handoff-dialog"].removeAttribute("open");
  });
  el["handoff-copy-button"].addEventListener("click", function () {
    copyText(el["handoff-content"].textContent).then(function (copied) { setText(el["handoff-copy-status"], copied ? "Handoff summary copied." : "Copy failed."); });
  });
  el["memory-toggle"].addEventListener("click", function () { state.memoryDrawerOpen = !state.memoryDrawerOpen; renderDrawer(); });
  el["memory-close"].addEventListener("click", function () { state.memoryDrawerOpen = false; renderDrawer(); });
  el["memory-scrim"].addEventListener("click", function () { state.memoryDrawerOpen = false; renderDrawer(); });
  el.feedback.addEventListener("click", function (event) {
    var button = event.target.closest("[data-feedback]");
    if (!button) return;
    state.active.feedback = button.dataset.feedback;
    renderConversation();
  });

  render();
  loadCustomerMemories(state.currentCustomerId, state.generation, false);
})();
