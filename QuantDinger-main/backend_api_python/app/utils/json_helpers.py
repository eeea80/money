"""Small JSON helper functions shared by services."""

from __future__ import annotations

import json
from typing import Any


def safe_json_loads(value: Any, default: Any = None) -> Any:
    """Parse JSON-like input without raising on malformed values."""
    if default is None:
        default = {}
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except Exception:
            return default
    return default
