"""Quick trade credential and client helpers."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from app.utils.credential_crypto import decrypt_credential_blob
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


def safe_json(value: Any, default=None):
    """Parse stored JSON-like credential content safely."""
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if isinstance(value, str) else default
    except Exception:
        return default


def load_credential(credential_id: int, user_id: int) -> Dict[str, Any]:
    """Load exchange credential JSON for the given user."""
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            "SELECT encrypted_config FROM qd_exchange_credentials WHERE id = %s AND user_id = %s",
            (int(credential_id), int(user_id)),
        )
        row = cur.fetchone() or {}
        cur.close()
    try:
        plain = decrypt_credential_blob(row.get("encrypted_config"))
    except ValueError as exc:
        logger.warning("decrypt credential_id=%s: %s", credential_id, exc)
        return {}
    return safe_json(plain, {})


def build_exchange_config(
    credential_id: int,
    user_id: int,
    overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build exchange config from saved credential and optional overrides."""
    base = load_credential(credential_id, user_id)
    if not base:
        raise ValueError("Credential not found or access denied")
    if overrides:
        for key, value in overrides.items():
            if value is not None and (not isinstance(value, str) or value.strip()):
                base[key] = value
    return base


def create_exchange_client(exchange_config: Dict[str, Any], market_type: str = "swap"):
    """Create an exchange client from config."""
    from app.services.live_trading.factory import create_client

    return create_client(exchange_config, market_type=market_type)
