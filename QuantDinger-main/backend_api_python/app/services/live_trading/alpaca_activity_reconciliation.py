"""Reconcile Alpaca account-level equity fees and margin interest to strategies."""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable

from app.services.exchange_execution import load_strategy_configs, resolve_exchange_config
from app.services.live_trading.factory import create_client
from app.services.live_trading.leg_context import credential_id_from_exchange_config
from app.services.live_trading.records import normalize_strategy_symbol
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore[misc,assignment]


logger = get_logger(__name__)
_sync_lock = threading.Lock()
_last_sync: Dict[int, float] = {}
_BULK_SELL_FEES = {"REG", "TAF"}
_BULK_ALL_FEES = {"CAT", "NRV", "NRC"}


def ensure_alpaca_activity_schema() -> None:
    statements = (
        """
        CREATE TABLE IF NOT EXISTS qd_strategy_broker_activities (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES qd_users(id) ON DELETE CASCADE,
            strategy_id INTEGER NOT NULL REFERENCES qd_strategies_trading(id) ON DELETE CASCADE,
            credential_id INTEGER NOT NULL DEFAULT 0,
            broker_id VARCHAR(40) NOT NULL DEFAULT '',
            activity_type VARCHAR(24) NOT NULL DEFAULT '',
            activity_subtype VARCHAR(24) NOT NULL DEFAULT '',
            symbol VARCHAR(50) NOT NULL DEFAULT '',
            currency VARCHAR(16) NOT NULL DEFAULT 'USD',
            amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
            account_amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
            allocation_ratio DECIMAL(20, 12) NOT NULL DEFAULT 1,
            allocation_reason VARCHAR(40) NOT NULL DEFAULT '',
            external_id VARCHAR(180) NOT NULL,
            occurred_at TIMESTAMP NOT NULL,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (credential_id, broker_id, external_id, strategy_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_broker_activity_strategy_time ON qd_strategy_broker_activities(strategy_id, occurred_at)",
        "CREATE INDEX IF NOT EXISTS idx_broker_activity_credential ON qd_strategy_broker_activities(credential_id, broker_id, external_id)",
    )
    with get_db_connection() as db:
        cur = db.cursor()
        for statement in statements:
            cur.execute(statement)
        db.commit()
        cur.close()


def _parse_datetime(value: Any) -> datetime:
    raw = str(value or "").strip()
    if raw:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            pass
    return datetime.now(timezone.utc)


def _activity_time(row: Dict[str, Any]) -> datetime:
    return _parse_datetime(
        row.get("at") or row.get("executed_at") or row.get("transaction_time")
        or row.get("date") or row.get("settle_date")
    )


def _details(row: Dict[str, Any]) -> Dict[str, Any]:
    value = row.get("details")
    return dict(value) if isinstance(value, dict) else {}


def _activity_subtype(row: Dict[str, Any]) -> str:
    value = row.get("activity_subtype") or row.get("activity_sub_type") or row.get("entry_sub_type")
    subtype = str(value or "").strip().upper()
    if subtype:
        return subtype
    description = str(row.get("description") or "").upper()
    for candidate in ("REG", "TAF", "CAT", "ADR", "COM", "MGN"):
        if candidate in description:
            return candidate
    if "MARGIN" in description and "INTEREST" in description:
        return "MGN"
    return ""


def _symbol(row: Dict[str, Any]) -> str:
    details = _details(row)
    raw = details.get("symbol") or row.get("symbol") or ""
    return normalize_strategy_symbol(str(raw)).upper()


def _business_date(row: Dict[str, Any], *, bulk_fee: bool = False) -> date:
    details = _details(row)
    explicit = details.get("system_date") or row.get("system_date") or row.get("settle_date")
    if explicit:
        return _parse_datetime(explicit).date()
    raw_date = row.get("date")
    if raw_date:
        value = _parse_datetime(raw_date).date()
        return value - timedelta(days=1) if bulk_fee else value
    dt = _activity_time(row)
    if ZoneInfo is not None:
        try:
            return dt.astimezone(ZoneInfo("America/New_York")).date()
        except Exception:
            pass
    return dt.date()


def _order_id(row: Dict[str, Any], fill_by_ref: Dict[str, str]) -> str:
    details = _details(row)
    direct = details.get("order_id") or row.get("order_id") or row.get("execution_id")
    if direct:
        return str(direct)
    parent = str(details.get("parent_id") or row.get("parent_id") or "").strip()
    return fill_by_ref.get(parent, "")


def _order_owners(credential_id: int) -> Dict[str, Dict[str, Any]]:
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT po.exchange_order_id, po.strategy_id, po.user_id, po.id AS pending_order_id,
                   COALESCE(SUM(COALESCE(t.commission_quote, t.commission, 0)), 0) AS recorded_commission
            FROM pending_orders po
            LEFT JOIN qd_strategy_trades t ON t.pending_order_id = po.id
            WHERE po.credential_id = %s AND LOWER(COALESCE(po.exchange_id, '')) = 'alpaca'
              AND COALESCE(po.exchange_order_id, '') <> '' AND po.strategy_id IS NOT NULL
            GROUP BY po.exchange_order_id, po.strategy_id, po.user_id, po.id
            """,
            (int(credential_id),),
        )
        rows = cur.fetchall() or []
        cur.close()
    return {str(row.get("exchange_order_id") or ""): dict(row) for row in rows}


def _eligible_fill(row: Dict[str, Any], subtype: str, target_date: date) -> bool:
    if _business_date(row) != target_date:
        return False
    side = str(row.get("side") or _details(row).get("side") or "").lower()
    return side == "sell" if subtype in _BULK_SELL_FEES else True


def _fill_metric(row: Dict[str, Any], subtype: str) -> float:
    try:
        qty = abs(float(row.get("qty") or 0.0))
        price = abs(float(row.get("price") or 0.0))
    except Exception:
        return 0.0
    return qty * price if subtype == "REG" or subtype not in {"TAF", "CAT"} else qty


def _fill_allocations(
    activity: Dict[str, Any], fills: Iterable[Dict[str, Any]], owners: Dict[str, Dict[str, Any]],
) -> list[tuple[int, int, float, str, float]]:
    subtype = _activity_subtype(activity)
    target_date = _business_date(activity, bulk_fee=subtype in (_BULK_SELL_FEES | _BULK_ALL_FEES))
    totals: Dict[int, tuple[int, float]] = {}
    account_total = 0.0
    for fill in fills:
        if not _eligible_fill(fill, subtype, target_date):
            continue
        metric = _fill_metric(fill, subtype)
        if metric <= 0:
            continue
        account_total += metric
        owner = owners.get(str(fill.get("order_id") or _details(fill).get("order_id") or ""))
        if not owner:
            continue
        strategy_id = int(owner.get("strategy_id") or 0)
        user_id = int(owner.get("user_id") or 0)
        previous = totals.get(strategy_id, (user_id, 0.0))[1]
        totals[strategy_id] = (user_id, previous + metric)
    if account_total <= 0:
        return []
    return [
        (strategy_id, user_id, metric / account_total, "account_fill_share", 0.0)
        for strategy_id, (user_id, metric) in totals.items() if metric > 0
    ]


def _position_allocations(
    *, credential_id: int, account_positions: Iterable[Dict[str, Any]], symbol: str = "",
) -> list[tuple[int, int, float, str, float]]:
    wanted = normalize_strategy_symbol(symbol).upper()
    account_total = 0.0
    for row in account_positions:
        row_symbol = normalize_strategy_symbol(str(row.get("symbol") or "")).upper()
        if wanted and row_symbol != wanted:
            continue
        account_total += abs(float(row.get("market_value") or row.get("marketValue") or 0.0))
    if account_total <= 0:
        return []
    with get_db_connection() as db:
        cur = db.cursor()
        params: list[Any] = [int(credential_id)]
        symbol_filter = ""
        if wanted:
            symbol_filter = " AND UPPER(COALESCE(p.symbol_canonical, p.symbol, '')) = %s"
            params.append(wanted)
        cur.execute(
            f"""
            SELECT p.strategy_id, p.user_id,
                   SUM(ABS(COALESCE(p.size, 0) * COALESCE(NULLIF(p.current_price, 0), p.entry_price, 0))) AS exposure
            FROM qd_strategy_positions p
            WHERE p.credential_id = %s AND ABS(COALESCE(p.size, 0)) > 0{symbol_filter}
            GROUP BY p.strategy_id, p.user_id
            """,
            tuple(params),
        )
        rows = cur.fetchall() or []
        cur.close()
    return [
        (int(row.get("strategy_id") or 0), int(row.get("user_id") or 0),
         min(1.0, float(row.get("exposure") or 0.0) / account_total), "account_position_share", 0.0)
        for row in rows if float(row.get("exposure") or 0.0) > 0
    ]


def _activity_allocations(
    activity: Dict[str, Any], *, fills: list[Dict[str, Any]], owners: Dict[str, Dict[str, Any]],
    account_positions: list[Dict[str, Any]], credential_id: int,
) -> list[tuple[int, int, float, str, float]]:
    fill_by_ref = {
        str(row.get("id") or row.get("ref_id") or ""): str(row.get("order_id") or _details(row).get("order_id") or "")
        for row in fills
    }
    exact = owners.get(_order_id(activity, fill_by_ref))
    if exact:
        return [(int(exact.get("strategy_id") or 0), int(exact.get("user_id") or 0), 1.0,
                 "parent_order", float(exact.get("recorded_commission") or 0.0))]
    subtype = _activity_subtype(activity)
    if subtype == "ADR":
        return _position_allocations(
            credential_id=credential_id, account_positions=account_positions, symbol=_symbol(activity),
        )
    if str(activity.get("activity_type") or "").upper() == "INT" or subtype == "MGN":
        return _position_allocations(credential_id=credential_id, account_positions=account_positions)
    return _fill_allocations(activity, fills, owners)


def _allocated_amount(
    account_amount: float, ratio: float, subtype: str, recorded_commission: float = 0.0,
) -> float:
    amount = account_amount * max(0.0, min(1.0, ratio))
    if subtype == "COM" and amount < 0 and recorded_commission > 0:
        amount = min(0.0, amount + recorded_commission)
    return amount


def _insert_activities(
    activities: Iterable[Dict[str, Any]], *, fills: list[Dict[str, Any]], owners: Dict[str, Dict[str, Any]],
    account_positions: list[Dict[str, Any]], credential_id: int,
) -> int:
    inserted = 0
    with get_db_connection() as db:
        cur = db.cursor()
        for raw in activities:
            activity = dict(raw or {})
            activity_type = str(activity.get("activity_type") or activity.get("entry_type") or "").upper()
            subtype = _activity_subtype(activity)
            if activity_type == "INT" and subtype not in {"MGN", ""}:
                continue
            try:
                account_amount = float(activity.get("net_amount") or 0.0)
            except Exception:
                continue
            if abs(account_amount) <= 1e-12:
                continue
            external_id = str(activity.get("id") or activity.get("ref_id") or "").strip()
            if not external_id:
                continue
            allocations = _activity_allocations(
                activity, fills=fills, owners=owners, account_positions=account_positions,
                credential_id=credential_id,
            )
            for strategy_id, user_id, ratio, reason, recorded_commission in allocations:
                amount = _allocated_amount(account_amount, ratio, subtype, recorded_commission)
                if strategy_id <= 0 or user_id <= 0 or abs(amount) <= 1e-12:
                    continue
                cur.execute(
                    """
                    INSERT INTO qd_strategy_broker_activities
                        (user_id, strategy_id, credential_id, broker_id, activity_type,
                         activity_subtype, symbol, currency, amount, account_amount,
                         allocation_ratio, allocation_reason, external_id, occurred_at, raw_json)
                    VALUES (%s, %s, %s, 'alpaca', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (credential_id, broker_id, external_id, strategy_id) DO NOTHING
                    """,
                    (user_id, strategy_id, credential_id, activity_type, subtype, _symbol(activity),
                     str(activity.get("currency") or "USD").upper(), amount, account_amount, ratio,
                     reason, external_id, _activity_time(activity).replace(tzinfo=None),
                     json.dumps(activity, ensure_ascii=False, default=str)),
                )
                inserted += int(cur.rowcount or 0)
        db.commit()
        cur.close()
    return inserted


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def sync_strategy_alpaca_activities(strategy_id: int, *, user_id: int = 0, force: bool = False) -> int:
    """Best-effort Alpaca fee sync; account/manual activity is excluded by allocation ratios."""
    sid = int(strategy_id or 0)
    if sid <= 0:
        return 0
    try:
        config = load_strategy_configs(sid)
        uid = int(user_id or config.get("user_id") or 0)
        exchange_config = resolve_exchange_config(config.get("exchange_config") or {}, user_id=uid)
        if str(exchange_config.get("exchange_id") or "").lower() != "alpaca":
            return 0
        credential_id = int(credential_id_from_exchange_config(exchange_config) or 0)
        if credential_id <= 0:
            return 0
        now_mono = time.monotonic()
        with _sync_lock:
            if not force and now_mono - float(_last_sync.get(credential_id, 0.0)) < 300.0:
                return 0
            _last_sync[credential_id] = now_mono
        ensure_alpaca_activity_schema()
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT COALESCE(MAX(a.occurred_at), MIN(s.created_at)) AS since
                FROM qd_strategies_trading s
                LEFT JOIN qd_strategy_broker_activities a
                  ON a.credential_id = %s AND a.broker_id = 'alpaca'
                WHERE s.user_id = %s
                  AND COALESCE(NULLIF(s.exchange_config->>'credential_id', ''),
                               NULLIF(s.exchange_config->>'credentials_id', ''), '0') = %s
                """,
                (credential_id, uid, str(credential_id)),
            )
            row = cur.fetchone() or {}
            cur.close()
        since = row.get("since")
        if not isinstance(since, datetime):
            since = datetime.now(timezone.utc) - timedelta(days=30)
        elif since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        since = max(since - timedelta(days=2), datetime.now(timezone.utc) - timedelta(days=90))
        client = create_client(exchange_config)
        activities = client.get_account_activities(activity_types=["FEE", "INT"], after=_iso(since))
        if not activities:
            return 0
        candidate_dates = set()
        for activity in activities:
            subtype = _activity_subtype(activity)
            candidate_dates.add(_business_date(activity, bulk_fee=subtype in (_BULK_SELL_FEES | _BULK_ALL_FEES)))
            candidate_dates.add(_activity_time(activity).date())
        fills_since = datetime.combine(min(candidate_dates), datetime.min.time(), tzinfo=timezone.utc) - timedelta(days=1)
        fills = client.get_account_activities(
            activity_types=["FILL"], after=_iso(fills_since), page_size=100, max_pages=50,
        )
        return _insert_activities(
            activities, fills=fills, owners=_order_owners(credential_id),
            account_positions=client.get_positions(), credential_id=credential_id,
        )
    except Exception as exc:
        logger.debug("Alpaca activity sync skipped for strategy=%s: %s", sid, exc)
        return 0


def is_alpaca_strategy(strategy_id: int, *, user_id: int = 0) -> bool:
    try:
        config = load_strategy_configs(int(strategy_id))
        uid = int(user_id or config.get("user_id") or 0)
        exchange_config = resolve_exchange_config(config.get("exchange_config") or {}, user_id=uid)
        return str(exchange_config.get("exchange_id") or "").strip().lower() == "alpaca"
    except Exception:
        return False


def load_strategy_broker_activity_summary(strategy_id: int) -> Dict[str, float]:
    defaults = {
        "broker_activity_payment": 0.0, "regulatory_payment": 0.0,
        "adr_payment": 0.0, "margin_interest_payment": 0.0, "other_broker_payment": 0.0,
    }
    try:
        ensure_alpaca_activity_schema()
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT COALESCE(SUM(amount), 0) AS total,
                       COALESCE(SUM(CASE WHEN activity_subtype IN ('REG','TAF','CAT') THEN amount ELSE 0 END), 0) AS regulatory,
                       COALESCE(SUM(CASE WHEN activity_subtype = 'ADR' THEN amount ELSE 0 END), 0) AS adr,
                       COALESCE(SUM(CASE WHEN activity_type = 'INT' OR activity_subtype = 'MGN' THEN amount ELSE 0 END), 0) AS margin_interest,
                       COALESCE(SUM(CASE WHEN activity_subtype NOT IN ('REG','TAF','CAT','ADR','MGN')
                                         AND activity_type <> 'INT' THEN amount ELSE 0 END), 0) AS other
                FROM qd_strategy_broker_activities WHERE strategy_id = %s
                """,
                (int(strategy_id),),
            )
            row = cur.fetchone() or {}
            cur.close()
        return {
            "broker_activity_payment": float(row.get("total") or 0.0),
            "regulatory_payment": float(row.get("regulatory") or 0.0),
            "adr_payment": float(row.get("adr") or 0.0),
            "margin_interest_payment": float(row.get("margin_interest") or 0.0),
            "other_broker_payment": float(row.get("other") or 0.0),
        }
    except Exception:
        return defaults


def sync_running_alpaca_activities() -> int:
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, user_id FROM qd_strategies_trading
                WHERE status = 'running' AND execution_mode = 'live'
                  AND market_category = 'USStock'
                """
            )
            rows = cur.fetchall() or []
            cur.close()
        return sum(
            sync_strategy_alpaca_activities(int(row.get("id") or 0), user_id=int(row.get("user_id") or 0))
            for row in rows
        )
    except Exception as exc:
        logger.debug("Running Alpaca activity sync skipped: %s", exc)
        return 0


__all__ = [
    "ensure_alpaca_activity_schema", "is_alpaca_strategy", "load_strategy_broker_activity_summary",
    "sync_running_alpaca_activities", "sync_strategy_alpaca_activities",
]
