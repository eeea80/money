"""Resolve durable robot types across current and legacy deployments."""

from __future__ import annotations

import json
from typing import Any, Mapping


KNOWN_BOT_TYPES = {"grid", "dca", "martingale", "layered_martingale", "trend"}


def _object(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
        return dict(parsed) if isinstance(parsed, Mapping) else {}
    return {}


def resolve_bot_type(
    strategy: Mapping[str, Any] | None,
    trading_config: Mapping[str, Any] | None = None,
    *,
    source_code: str = "",
) -> str:
    """Return the bot type without silently downgrading legacy robots.

    Early Strategy API V2 robot deployments persisted ``executor_type`` and
    source metadata but not the later top-level ``bot_type`` field.  Treating
    those rows as ordinary bar strategies is unsafe for grids because their
    exchange-resting order engine would never start.
    """
    row = dict(strategy or {})
    config = dict(trading_config or _object(row.get("trading_config")))
    metadata = _object(row.get("metadata"))
    manifest = _object(config.get("strategy_manifest"))

    candidates = (
        row.get("bot_type"),
        config.get("bot_type"),
        config.get("executor_type"),
        metadata.get("executor_type"),
        manifest.get("executor_type"),
    )
    for candidate in candidates:
        value = str(candidate or "").strip().lower().replace("-", "_")
        if value in KNOWN_BOT_TYPES:
            return value

    # Some early visual-builder deployments retained bot_params but lost both
    # bot_type and executor_type while copying the source into a live strategy.
    # A complete grid parameter signature is unambiguous and must route to the
    # exchange-resting GridEngine rather than the generic bar-order gateway.
    bot_params = _object(config.get("bot_params"))
    normalized_param_keys = {
        str(key or "").strip().lower().replace("_", "")
        for key in bot_params
    }
    if {"gridcount", "lowerprice", "upperprice"} <= normalized_param_keys:
        return "grid"

    template_key = str(row.get("template_key") or metadata.get("template_key") or "").strip().lower()
    for value in ("layered_martingale", "martingale", "grid", "dca", "trend"):
        if value in template_key:
            return value

    # Last-resort recovery for existing rows whose runtime metadata was already
    # damaged.  Use several generator-only constants together so ordinary user
    # strategies mentioning the word "grid" are never reclassified.
    code = str(source_code or "")
    grid_markers = (
        "GRID_TEMPLATE_VERSION",
        "CELL_LOWER",
        "CELL_UPPER",
        "CELL_ROLES",
        "MAX_OPEN_ENTRY_ORDERS",
    )
    if all(marker in code for marker in grid_markers):
        return "grid"
    dca_markers = (
        "DCA_TEMPLATE_VERSION",
        "DCA_INTERVAL_MINUTES",
        "DCA_MAX_ORDERS",
        "DCA_TOTAL_BUDGET_PCT",
        "def _reconcile_purchase(",
    )
    if all(marker in code for marker in dca_markers):
        return "dca"
    realtime_robot_markers = (
        "ROBOT_TEMPLATE_VERSION",
        "ENTRY_TRIGGER_MODE = 'realtime_price'",
        "PRICE_LEVELS",
        "def on_price_tick(",
    )
    if all(marker in code for marker in realtime_robot_markers):
        if "Strategy API V2 layered martingale robot generated" in code:
            return "layered_martingale"
        if "Strategy API V2 martingale robot generated" in code:
            return "martingale"
    return ""


__all__ = ["KNOWN_BOT_TYPES", "resolve_bot_type"]
