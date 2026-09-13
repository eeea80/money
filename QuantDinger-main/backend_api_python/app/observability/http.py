"""HTTP request correlation and metrics middleware."""

from __future__ import annotations

import re
import time
import uuid

from flask import Flask, g, request

from app.observability.context import request_id_context
from app.observability.metrics import HTTP_DURATION, HTTP_IN_PROGRESS, HTTP_REQUESTS


_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _request_id() -> str:
    incoming = str(request.headers.get("X-Request-ID") or "").strip()
    if incoming and _REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return uuid.uuid4().hex


def init_http_observability(app: Flask) -> None:
    @app.before_request
    def start_request_observation():
        request_id = _request_id()
        g.request_id = request_id
        g.request_started_monotonic = time.perf_counter()
        g.request_metrics_active = True
        g.request_context_token = request_id_context.set(request_id)
        HTTP_IN_PROGRESS.labels(method=request.method).inc()

    @app.after_request
    def finish_request_observation(response):
        route = request.url_rule.rule if request.url_rule is not None else "unmatched"
        started = getattr(g, "request_started_monotonic", time.perf_counter())
        duration = max(0.0, time.perf_counter() - started)
        HTTP_REQUESTS.labels(
            method=request.method,
            route=route,
            status=str(response.status_code),
        ).inc()
        HTTP_DURATION.labels(method=request.method, route=route).observe(duration)
        response.headers["X-Request-ID"] = getattr(g, "request_id", "")
        return response

    @app.teardown_request
    def clear_request_observation(_error=None):
        if getattr(g, "request_metrics_active", False):
            HTTP_IN_PROGRESS.labels(method=request.method).dec()
            g.request_metrics_active = False
        token = getattr(g, "request_context_token", None)
        if token is not None:
            # ``stream_with_context`` can tear down the same request context
            # once when the view returns and again when the response iterator
            # closes. ContextVar tokens are single-use, so make the cleanup
            # idempotent before resetting it. Otherwise the second teardown
            # raises RuntimeError and Gunicorn terminates an otherwise complete
            # SSE/chunked response without its final HTTP chunk.
            g.request_context_token = None
            try:
                request_id_context.reset(token)
            except (RuntimeError, ValueError):
                # A copied streaming context may retain a token that was
                # already reset, or was created in its parent context. The
                # request is ending, so clearing the correlation value is the
                # safe fallback for this execution context.
                request_id_context.set("")
