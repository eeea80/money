"""Request-scoped logging context."""

from contextvars import ContextVar


request_id_context: ContextVar[str] = ContextVar("request_id", default="")
