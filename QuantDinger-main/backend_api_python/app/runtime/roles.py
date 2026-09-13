"""Explicit process roles for the backend deployment."""

from __future__ import annotations

import os
from enum import Enum


class ProcessRole(str, Enum):
    LEGACY = "legacy"
    API = "api"
    TRADING = "trading"
    SCHEDULER = "scheduler"
    CELERY = "celery"


def current_process_role() -> ProcessRole:
    raw = os.getenv("QD_PROCESS_ROLE", ProcessRole.LEGACY.value).strip().lower()
    try:
        return ProcessRole(raw)
    except ValueError as exc:
        allowed = ", ".join(role.value for role in ProcessRole)
        raise RuntimeError(f"Invalid QD_PROCESS_ROLE={raw!r}; expected one of: {allowed}") from exc


def strategy_commands_enabled() -> bool:
    raw = os.getenv("STRATEGY_COMMANDS_ENABLED")
    if raw is None:
        return current_process_role() is ProcessRole.API
    return raw.strip().lower() in {"1", "true", "yes", "on"}
