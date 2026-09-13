"""Stable categories for exchange order failures shown to users and health checks."""

from __future__ import annotations

import re
from typing import Any


def classify_exchange_order_error(error: Any) -> dict[str, Any]:
    raw = str(error or "").strip()
    lower = raw.lower()
    http_match = re.search(r"\bhttp\s+(\d{3})\b|\b(5\d{2})\s+(?:bad gateway|gateway timeout|service unavailable)\b", lower)
    http_status = int(next((value for value in (http_match.groups() if http_match else ()) if value), 0) or 0)
    if http_status >= 500 or any(token in lower for token in (
        "bad gateway", "gateway timeout", "service unavailable", "connection reset",
        "connection timed out", "timeout waiting for response", "temporarily unavailable",
    )):
        return {"category": "transport", "retryable": True, "http_status": http_status, "raw": raw}
    if any(token in lower for token in (
        "insufficient_available", "insufficient balance", "insufficient margin",
        "not enough balance", "margin insufficient",
    )):
        return {"category": "insufficient_funds", "retryable": False, "http_status": http_status, "raw": raw}
    if re.search(r"below|step|minqty|min qty|minsize|min size|min_notional|minnotional|invalid (qty|quantity|size|amount)", lower):
        return {"category": "order_size", "retryable": False, "http_status": http_status, "raw": raw}
    if any(token in lower for token in ("position mode", "margin mode", "leverage")):
        return {"category": "account_configuration", "retryable": False, "http_status": http_status, "raw": raw}
    return {"category": "exchange_rejected", "retryable": False, "http_status": http_status, "raw": raw}


__all__ = ["classify_exchange_order_error"]
