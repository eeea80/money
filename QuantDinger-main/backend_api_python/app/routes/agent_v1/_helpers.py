"""Shared helpers for agent_v1 routes."""
from __future__ import annotations

from typing import Any, Optional

from flask import jsonify, request


def envelope(data: Any, *, message: str = "ok", code: int = 0, status: int = 200) -> tuple:
    """Standard agent-facing response envelope.

    Distinct from the legacy human envelope (`code: 1, msg, data`) so client
    code targeting `/api/agent/v1` can rely on a single, stable shape.

    The HTTP status defaults to 200; pass ``status=202`` for async-queue
    responses.  Always returns a (Response, status) tuple so callers must
    NOT wrap the result in another tuple — that produces nested tuples
    Flask cannot decode.
    """
    return jsonify({
        "code": code,
        "message": message,
        "data": data,
    }), status


def error(code: int, message: str, *, details: Any = None, retriable: bool = False, http: int = 400):
    return jsonify({
        "code": code,
        "message": message,
        "details": details,
        "retriable": retriable,
        "data": None,
    }), http


def get_json_or_400() -> tuple[Optional[dict], Optional[tuple]]:
    """Parse JSON body; on failure return (None, error_response).

    Use as:
        body, err = get_json_or_400()
        if err:
            return err
    """
    if not request.is_json and not (request.data or b"").strip():
        return None, error(400, "JSON body required", http=400)
    body = request.get_json(silent=True)
    if body is None:
        return None, error(400, "Invalid JSON body", http=400)
    if not isinstance(body, dict):
        return None, error(400, "JSON body must be an object", http=400)
    return body, None


def clip_int(value, *, default: int, lo: int, hi: int) -> int:
    try:
        v = int(value)
    except Exception:
        return default
    return max(lo, min(hi, v))
