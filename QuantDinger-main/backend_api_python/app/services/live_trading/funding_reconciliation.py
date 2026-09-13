"""Persist exchange-settled funding cash flows and attribute them to strategy positions."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable

from app.services.exchange_execution import load_strategy_configs, resolve_exchange_config
from app.services.live_trading.factory import create_client
from app.services.live_trading.leg_context import credential_id_from_exchange_config
from app.services.live_trading.records import normalize_strategy_symbol
from app.utils.db import get_db_connection
from app.utils.logger import get_logger


logger = get_logger(__name__)
_sync_lock = threading.Lock()
_last_sync: Dict[int, float] = {}


def ensure_funding_ledger_schema() -> None:
    statements = (
        """
        CREATE TABLE IF NOT EXISTS qd_strategy_funding_fees (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL DEFAULT 1 REFERENCES qd_users(id) ON DELETE CASCADE,
            strategy_id INTEGER NOT NULL REFERENCES qd_strategies_trading(id) ON DELETE CASCADE,
            credential_id INTEGER NOT NULL DEFAULT 0,
            exchange_id VARCHAR(40) NOT NULL DEFAULT '',
            symbol VARCHAR(50) NOT NULL DEFAULT '',
            asset VARCHAR(20) NOT NULL DEFAULT 'USDT',
            amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
            allocation_ratio DECIMAL(20, 12) NOT NULL DEFAULT 1,
            external_id VARCHAR(160) NOT NULL,
            occurred_at TIMESTAMP NOT NULL,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (credential_id, exchange_id, external_id, strategy_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_strategy_funding_strategy_time ON qd_strategy_funding_fees(strategy_id, occurred_at)",
        "CREATE INDEX IF NOT EXISTS idx_strategy_funding_credential ON qd_strategy_funding_fees(credential_id, exchange_id, external_id)",
    )
    with get_db_connection() as db:
        cur = db.cursor()
        for sql in statements:
            cur.execute(sql)
        db.commit()
        cur.close()


def _utc_from_ms(value: Any) -> datetime:
    try:
        ms = int(float(value or 0))
    except Exception:
        ms = 0
    if ms <= 0:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    if ms < 10_000_000_000:
        ms *= 1000
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).replace(tzinfo=None)


def _position_allocations(*, credential_id: int, symbol: str, fallback_strategy_id: int) -> list[tuple[int, float]]:
    canon = normalize_strategy_symbol(symbol).upper()
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT p.strategy_id, p.symbol, p.symbol_canonical, p.size
            FROM qd_strategy_positions p
            JOIN qd_strategies_trading s ON s.id = p.strategy_id
            WHERE ABS(COALESCE(p.size, 0)) > 0
              AND s.execution_mode = 'live'
              AND (p.credential_id = %s
                   OR (COALESCE(p.credential_id, 0) = 0
                       AND COALESCE(NULLIF(s.exchange_config::jsonb->>'credential_id', ''),
                                    s.exchange_config::jsonb->>'credentials_id') = %s))
            """,
            (int(credential_id or 0), str(credential_id or 0)),
        )
        rows = cur.fetchall() or []
        cur.close()
    totals: Dict[int, float] = {}
    for row in rows:
        row_symbol = normalize_strategy_symbol(
            str(row.get("symbol_canonical") or row.get("symbol") or "")
        ).upper()
        if row_symbol != canon:
            continue
        sid = int(row.get("strategy_id") or 0)
        qty = abs(float(row.get("size") or 0.0))
        if sid > 0 and qty > 0:
            totals[sid] = totals.get(sid, 0.0) + qty
    quantities = list(totals.items())
    total = sum(qty for _, qty in quantities)
    if total > 0:
        return [(sid, qty / total) for sid, qty in quantities]
    return [(int(fallback_strategy_id), 1.0)] if int(fallback_strategy_id or 0) > 0 else []


def _insert_payments(
    payments: Iterable[Dict[str, Any]], *, user_id: int, strategy_id: int,
    credential_id: int, exchange_id: str, requested_symbol: str,
) -> int:
    inserted = 0
    requested = normalize_strategy_symbol(requested_symbol).upper()
    with get_db_connection() as db:
        cur = db.cursor()
        for raw in payments or []:
            payment = dict(raw or {})
            raw_symbol = str(payment.get("symbol") or requested_symbol).upper()
            symbol = normalize_strategy_symbol(raw_symbol).upper()
            if requested and symbol and symbol != requested:
                requested_compact = requested.replace("/", "")
                raw_compact = raw_symbol.replace("-", "").replace("_", "").replace("/", "")
                if requested_compact not in raw_compact:
                    continue
            external_id = str(payment.get("id") or "").strip()
            if not external_id:
                continue
            cur.execute(
                """
                SELECT 1 FROM qd_strategy_funding_fees
                WHERE credential_id = %s AND exchange_id = %s AND external_id = %s
                LIMIT 1
                """,
                (credential_id, exchange_id, external_id),
            )
            if cur.fetchone():
                continue
            amount = float(payment.get("amount") or 0.0)
            occurred_at = _utc_from_ms(payment.get("time"))
            allocations = _position_allocations(
                credential_id=credential_id, symbol=requested_symbol, fallback_strategy_id=strategy_id,
            )
            for owner_id, ratio in allocations:
                cur.execute("SELECT user_id FROM qd_strategies_trading WHERE id = %s", (owner_id,))
                owner = cur.fetchone() or {}
                owner_user_id = int(owner.get("user_id") or user_id)
                cur.execute(
                    """
                    INSERT INTO qd_strategy_funding_fees
                        (user_id, strategy_id, credential_id, exchange_id, symbol, asset, amount,
                         allocation_ratio, external_id, occurred_at, raw_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (credential_id, exchange_id, external_id, strategy_id) DO NOTHING
                    """,
                    (owner_user_id, owner_id, credential_id, exchange_id, requested or symbol,
                     str(payment.get("asset") or "USDT").upper(), amount * ratio, ratio,
                     external_id, occurred_at, json.dumps(payment.get("raw") or {}, ensure_ascii=False, default=str)),
                )
                inserted += int(cur.rowcount or 0)
        db.commit()
        cur.close()
    return inserted


def sync_strategy_funding(strategy_id: int, *, user_id: int = 0, force: bool = False) -> int:
    """Best-effort sync; never raises into order execution or API response paths."""
    sid = int(strategy_id or 0)
    if sid <= 0:
        return 0
    now_mono = time.monotonic()
    with _sync_lock:
        if not force and now_mono - float(_last_sync.get(sid, 0.0)) < 300.0:
            return 0
        _last_sync[sid] = now_mono
    try:
        ensure_funding_ledger_schema()
        config = load_strategy_configs(sid)
        uid = int(user_id or config.get("user_id") or 0)
        market_type = str(config.get("market_type") or "swap").strip().lower()
        if market_type not in ("swap", "future", "futures", "perp", "perpetual"):
            return 0
        exchange_config = resolve_exchange_config(config.get("exchange_config") or {}, user_id=uid)
        exchange_id = str(exchange_config.get("exchange_id") or exchange_config.get("exchangeId") or "").lower()
        if exchange_id not in {"binance", "okx", "bitget", "bybit", "gate", "htx"}:
            return 0
        credential_id = int(credential_id_from_exchange_config(exchange_config) or 0)
        symbol = str(config.get("symbol") or "").strip()
        if not symbol:
            return 0
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT COALESCE(MAX(occurred_at),
                    (SELECT created_at FROM qd_strategies_trading WHERE id = %s)) AS since
                FROM qd_strategy_funding_fees WHERE strategy_id = %s
                """,
                (sid, sid),
            )
            row = cur.fetchone() or {}
            cur.close()
        since = row.get("since")
        if hasattr(since, "replace") and getattr(since, "tzinfo", None) is None:
            since = since.replace(tzinfo=timezone.utc)
        start_ms = int(since.timestamp() * 1000) - 60_000 if hasattr(since, "timestamp") else int(time.time() * 1000) - 7 * 86400_000
        end_ms = int(time.time() * 1000)
        # The strictest supported private-ledger window (Bybit) is seven days.
        # The five-minute recurring sync makes this sufficient after initial backfill.
        start_ms = max(start_ms, end_ms - (7 * 86400_000 - 60_000))
        client = create_client(exchange_config, market_type="swap")
        payments = client.get_funding_payments(
            symbol=symbol, start_time_ms=max(0, start_ms), end_time_ms=end_ms, limit=100,
        )
        return _insert_payments(
            payments, user_id=uid, strategy_id=sid, credential_id=credential_id,
            exchange_id=exchange_id, requested_symbol=symbol,
        )
    except Exception as exc:
        logger.debug("Funding sync skipped for strategy=%s: %s", sid, exc)
        return 0


def load_strategy_funding_summary(strategy_id: int) -> Dict[str, float]:
    try:
        ensure_funding_ledger_schema()
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                "SELECT COALESCE(SUM(amount), 0) AS payment FROM qd_strategy_funding_fees WHERE strategy_id = %s",
                (int(strategy_id),),
            )
            row = cur.fetchone() or {}
            cur.close()
        payment = float(row.get("payment") or 0.0)
    except Exception:
        payment = 0.0
    return {"funding_payment": payment, "funding_cost": -payment}


def sync_running_strategy_funding() -> int:
    """Poll all running live perpetual strategies; per-strategy cache limits API traffic."""
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, user_id FROM qd_strategies_trading
                WHERE status = 'running' AND execution_mode = 'live'
                  AND LOWER(COALESCE(market_type, 'swap')) IN
                      ('swap', 'future', 'futures', 'perp', 'perpetual')
                ORDER BY id
                """
            )
            rows = cur.fetchall() or []
            cur.close()
        return sum(
            sync_strategy_funding(int(row.get("id") or 0), user_id=int(row.get("user_id") or 0))
            for row in rows
        )
    except Exception as exc:
        logger.debug("Running strategy funding sync skipped: %s", exc)
        return 0


__all__ = [
    "ensure_funding_ledger_schema", "load_strategy_funding_summary",
    "sync_running_strategy_funding", "sync_strategy_funding",
]
