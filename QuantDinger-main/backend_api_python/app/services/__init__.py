"""Lazy application service exports."""

from __future__ import annotations

from importlib import import_module
from typing import Any


_EXPORTS = {
    "KlineService": ("app.services.kline", "KlineService"),
    "FastAnalysisService": ("app.services.fast_analysis", "FastAnalysisService"),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(name)
    module_name, attribute = target
    value = getattr(import_module(module_name), attribute)
    globals()[name] = value
    return value
