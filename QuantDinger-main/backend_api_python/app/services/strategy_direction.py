"""Strategy trading-direction capability helpers."""

from __future__ import annotations

import ast
from typing import Any, Iterable


DIRECTION_MODES = {"long_only", "short_only", "both", "neutral"}


def normalize_direction_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "long": "long_only",
        "buy": "long_only",
        "1": "long_only",
        "1.0": "long_only",
        "+1": "long_only",
        "longonly": "long_only",
        "short": "short_only",
        "sell": "short_only",
        "_1": "short_only",
        "_1.0": "short_only",
        "-1": "short_only",
        "shortonly": "short_only",
        "dual": "both",
        "hedged": "both",
        "bidirectional": "both",
        "two_way": "both",
    }
    result = aliases.get(normalized, normalized)
    return result if result in DIRECTION_MODES else ""


def direction_mode_position_side(value: Any) -> str:
    mode = normalize_direction_mode(value)
    if mode == "long_only":
        return "long"
    if mode == "short_only":
        return "short"
    if mode in {"both", "neutral"}:
        return "neutral"
    return ""


def direction_mode_owned_legs(value: Any) -> set[str]:
    mode = normalize_direction_mode(value)
    if mode == "long_only":
        return {"long"}
    if mode == "short_only":
        return {"short"}
    return {"long", "short"}


def direction_mode_allows(value: Any, position_side: Any) -> bool:
    mode = normalize_direction_mode(value)
    side = str(position_side or "").strip().lower()
    if side not in {"long", "short"}:
        return True
    if mode in {"both", "neutral"}:
        return True
    return (mode == "long_only" and side == "long") or (
        mode == "short_only" and side == "short"
    )


def direction_mode_from_manifest(manifest: Any) -> str:
    if not isinstance(manifest, dict):
        return ""
    metadata = manifest.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    candidates: Iterable[Any] = (
        manifest.get("directionMode"),
        manifest.get("direction_mode"),
        metadata.get("direction_mode"),
        metadata.get("directionMode"),
        metadata.get("trade_direction"),
        metadata.get("position_side"),
        metadata.get("side"),
    )
    for candidate in candidates:
        mode = normalize_direction_mode(candidate)
        if mode:
            return mode
    return ""


def infer_direction_mode_from_code(code: str) -> str:
    try:
        tree = ast.parse(str(code or ""))
    except (SyntaxError, ValueError):
        return ""

    direction_constant = ""
    explicit_sides: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(
                isinstance(target, ast.Name) and target.id == "DIRECTION"
                for target in targets
            ):
                try:
                    direction_constant = normalize_direction_mode(ast.literal_eval(node.value))
                except (TypeError, ValueError):
                    pass
        if not isinstance(node, ast.Call):
            continue
        for keyword in node.keywords:
            if keyword.arg not in {"position_side", "positionSide"}:
                continue
            try:
                side = str(ast.literal_eval(keyword.value) or "").strip().lower()
            except (TypeError, ValueError):
                continue
            if side in {"long", "short"}:
                explicit_sides.add(side)

    if explicit_sides == {"long", "short"}:
        return "both"
    if explicit_sides == {"long"}:
        return "long_only"
    if explicit_sides == {"short"}:
        return "short_only"
    return direction_constant
