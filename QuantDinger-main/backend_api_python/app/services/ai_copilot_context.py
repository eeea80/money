"""Bounded, backend-owned context assembly for AI Copilot.

The browser sends only current UI state. Conversation history, rolling summaries,
approved memories and report references are resolved on the server so a client
cannot accidentally duplicate or forge them.
"""
from __future__ import annotations

import json
import re
from typing import Any


SERVER_OWNED_CONTEXT_KEYS = {
    "copilot_recent_messages",
    "recent_messages",
    "history",
    "messages",
    "user_memories",
    "session_working_memory",
    "session_summary",
    "referenced_report",
}


def estimate_tokens(value: Any) -> int:
    """Conservative provider-independent token estimate for Latin/CJK text."""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, default=str)
    cjk = len(re.findall(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]", value))
    other = max(0, len(value) - cjk)
    return max(1, cjk + (other + 3) // 4)


def sanitize_client_context(context: dict | None) -> dict:
    clean: dict[str, Any] = {}
    for key, value in (context or {}).items():
        if key in SERVER_OWNED_CONTEXT_KEYS:
            continue
        clean[str(key)] = value
    return clean


def _terms(text: str) -> set[str]:
    latin = re.findall(r"[a-zA-Z][a-zA-Z0-9_./-]{1,}", text.lower())
    cjk = re.findall(r"[\u3400-\u9fff]{2,6}", text)
    return set(latin + cjk)


def select_relevant_memories(memories: list[dict], message: str, context: dict, limit: int = 5) -> list[dict]:
    query = " ".join([
        message or "",
        str(context.get("market") or ""),
        str(context.get("symbol") or ""),
        str(context.get("research_mode") or ""),
    ])
    query_terms = _terms(query)
    scored: list[tuple[int, int, dict]] = []
    for index, memory in enumerate(memories or []):
        text = f"{memory.get('title') or ''} {memory.get('content') or ''}"
        overlap = len(query_terms & _terms(text))
        category = str(memory.get("category") or "")
        constraint_bonus = 3 if category in {"constraint", "risk", "preference"} else 0
        marker_bonus = 2 if re.search(r"不要|必须|偏好|avoid|must|prefer|risk", text, re.I) else 0
        scored.append((overlap * 10 + constraint_bonus + marker_bonus, -index, memory))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    relevant = [item[2] for item in scored if item[0] > 0]
    if len(relevant) < limit:
        seen = {id(item) for item in relevant}
        relevant.extend(item for item in memories or [] if id(item) not in seen)
    return relevant[: max(0, int(limit))]


def _compact(value: Any, limit: int = 320) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _stable_constraints(text: str) -> list[str]:
    out: list[str] = []
    for sentence in re.split(r"[。！？!?;；\n]+", text):
        if re.search(r"不要|不能|必须|偏好|只做|不做|avoid|must|prefer|never|only", sentence, re.I):
            compact = _compact(sentence, 240)
            if compact and compact not in out:
                out.append(compact)
    return out[-8:]


def merge_session_summary(
    previous: dict | None,
    history: list[dict],
    current_message: str,
    context: dict,
) -> dict:
    """Create a deterministic task-state summary without copying the transcript."""
    previous = previous or {}
    user_texts = [
        _compact(item.get("content"), 420)
        for item in history[-16:]
        if item.get("role") == "user" and item.get("content")
    ]
    current = _compact(current_message, 420)
    if current:
        user_texts.append(current)
    combined = "\n".join(user_texts[-8:])

    target = dict(previous.get("selected_target") or {})
    if context.get("market"):
        target["market"] = str(context.get("market"))[:32]
    if context.get("symbol"):
        target["symbol"] = str(context.get("symbol"))[:64]

    timeframe = str(previous.get("timeframe") or "")
    matches = re.findall(
        r"(?<![a-z0-9])(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|1w)(?![a-z0-9])|"
        r"(日线|周线|\d+\s*(?:分钟|小时|天|周))",
        combined,
        re.I,
    )
    if matches:
        timeframe = next((part for part in matches[-1] if part), timeframe)

    constraints = list(previous.get("stable_constraints") or [])
    for item in _stable_constraints(combined):
        if item not in constraints:
            constraints.append(item)

    request_summaries = list(previous.get("recent_requests") or [])
    # Keep intent-bearing requests, but strip price-like numeric claims that age badly.
    for text in user_texts[-4:]:
        safe = re.sub(r"(?<![A-Za-z])[$¥€£]?\d+(?:[.,]\d+)?%?", "[number]", text)
        safe = _compact(safe, 260)
        if safe and safe not in request_summaries:
            request_summaries.append(safe)

    workflow = str(context.get("research_mode") or context.get("intent") or previous.get("active_workflow") or "chat")[:64]
    result = {
        "selected_target": target,
        "timeframe": timeframe,
        "active_workflow": workflow,
        "stable_constraints": constraints[-8:],
        "recent_requests": request_summaries[-5:],
    }
    return {key: value for key, value in result.items() if value not in ({}, [], "")}


def compact_report_context(report_message: dict | None) -> dict:
    if not report_message:
        return {}
    report = report_message.get("report") or {}
    target = report_message.get("report_target") or {}
    market_data = report.get("market_data") or {}
    plan = report.get("trading_plan") or {}
    compact = {
        "message_id": report_message.get("id"),
        "target": {
            "market": report.get("market") or target.get("market"),
            "symbol": report.get("symbol") or target.get("symbol"),
        },
        "generated_at": report.get("generated_at") or report_message.get("created_at"),
        "decision": report.get("decision"),
        "confidence": report.get("confidence"),
        "summary": _compact(report.get("summary"), 900),
        "market_data": {
            "current_price": market_data.get("current_price"),
            "change_24h": market_data.get("change_24h"),
            "data_time": market_data.get("data_time") or market_data.get("timestamp"),
        },
        "trading_plan": {
            key: plan.get(key)
            for key in ("direction", "entry_price", "stop_loss", "take_profit", "risk_reward_ratio", "rr_warning")
            if plan.get(key) is not None
        },
        "risk_factors": (report.get("risk_factors") or report.get("risks") or [])[:5],
    }
    return compact


def fit_messages_to_budget(messages: list[dict], max_tokens: int = 24000) -> tuple[list[dict], dict]:
    """Drop oldest history first and then compact system context, preserving the user turn."""
    items = list(messages)

    def count() -> int:
        return sum(estimate_tokens(item.get("content") or "") + 4 for item in items)

    initial = count()
    truncated = False
    while len(items) > 2 and count() > max_tokens:
        del items[1]
        truncated = True
    if count() > max_tokens and items:
        system = str(items[0].get("content") or "")
        keep_tokens = max(1200, max_tokens - sum(estimate_tokens(x.get("content") or "") for x in items[1:]) - 200)
        keep_chars = keep_tokens * 3
        if len(system) > keep_chars:
            head = max(1000, keep_chars - 5000)
            items[0] = dict(items[0], content=system[:head] + "\n[Context compacted]\n" + system[-5000:])
            truncated = True
    final = count()
    return items, {
        "estimated_input_tokens": final,
        "input_tokens_before_budget": initial,
        "history_message_count": max(0, len(items) - 2),
        "context_truncated": truncated,
    }
