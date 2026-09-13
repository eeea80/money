"""Account-leg ownership and allocation shortfall controls.

The exchange exposes one aggregate position per account instrument leg.  This
module keeps the missing ownership layer between the L1 exchange mirror and L3
strategy ledgers:

    account quantity >= strategy allocations

Any account surplus is user-owned inventory and never blocks strategy entries.
Only a material account shortfall blocks new entries on that leg. Reduce-only
exits remain capped by the strategy ledger, the exchange position, and other
strategy allocations.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Dict, Iterable, List, Tuple

from app.services.live_trading.records import normalize_strategy_symbol
from app.utils.db import get_db_connection
from app.utils.numeric_precision import format_decimal


STRICT_MODE = "strict"
ADVANCED_MODE = "advanced"
STATUS_OK = "ok"
STATUS_BLOCKED = "drift_blocked"
COEXISTENCE_MARKET_TYPES = frozenset({"spot", "swap"})
CRYPTO_COEXISTENCE_EXCHANGES = frozenset({
    "binance", "bitget", "bybit", "gate", "htx", "okx",
})
DEFAULT_DRIFT_RELATIVE_TOLERANCE = 0.001
DEFAULT_SHORTFALL_RELATIVE_TOLERANCE = 0.005
DEFAULT_DRIFT_QUOTE_TOLERANCE = 10.0


def quote_drift_tolerance(symbol: str, price: float, quote_limit: float = DEFAULT_DRIFT_QUOTE_TOLERANCE) -> float:
    symbol = canonical_symbol(symbol).split("@", 1)[0]
    price = float(price or 0.0)
    if not symbol.endswith(("/USDT", "/USDC", "/USD")) or not math.isfinite(price) or price <= 0:
        return 0.0
    limit = float(quote_limit)
    if not math.isfinite(limit):
        limit = DEFAULT_DRIFT_QUOTE_TOLERANCE
    return min(DEFAULT_DRIFT_QUOTE_TOLERANCE, max(0.0, limit)) / price


def normalize_market_type(value: str) -> str:
    market = str(value or "swap").strip().lower()
    if market in {"future", "futures", "perp", "perpetual"}:
        return "swap"
    return market


def supports_position_coexistence(value: str, exchange_id: str = "") -> bool:
    """Return whether execution enforces account allocation coverage for this venue."""
    market = normalize_market_type(value)
    exchange = str(exchange_id or "").strip().lower()
    if exchange == "alpaca":
        return market in {"spot", "usstock", "crypto"}
    if market not in COEXISTENCE_MARKET_TYPES:
        return False
    return market == "swap" or not exchange or exchange in CRYPTO_COEXISTENCE_EXCHANGES


def normalize_side(value: str) -> str:
    side = str(value or "").strip().lower()
    return side if side in {"long", "short"} else ""


def canonical_symbol(value: str) -> str:
    return normalize_strategy_symbol(str(value or "")).upper()


@dataclass(frozen=True)
class OwnershipSnapshot:
    symbol: str
    side: str
    account_qty: float
    strategy_qty: float
    protected_qty: float
    expected_qty: float
    unknown_qty: float
    tolerance: float
    coexistence_mode: str
    status: str
    reason: str
    allowed: bool
    should_log: bool = False

    def metadata(self) -> Dict[str, Any]:
        return asdict(self)


def calculate_position_ownership(
    *,
    symbol: str,
    side: str,
    account_qty: float,
    strategy_qty: float,
    protected_qty: float = 0.0,
    coexistence_mode: str = STRICT_MODE,
    previous_status: str = "",
    previous_reason: str = "",
    absolute_tolerance: float = 0.0,
    shortfall_relative_tolerance: float = DEFAULT_SHORTFALL_RELATIVE_TOLERANCE,
    reference_price: float = 0.0,
) -> OwnershipSnapshot:
    """Pure ownership calculation used by execution, APIs, and tests."""
    account = max(0.0, float(account_qty or 0.0))
    strategy = max(0.0, float(strategy_qty or 0.0))
    # ``protected_qty`` and coexistence mode remain accepted for API and stored
    # row compatibility. Protection is now derived from the live surplus so a
    # stale manual baseline cannot stop entries or consume strategy inventory.
    protected = max(0.0, account - strategy)
    mode = ADVANCED_MODE if str(coexistence_mode or "").lower() == ADVANCED_MODE else STRICT_MODE
    expected = strategy
    unknown = account - strategy
    # Base-asset fees and exchange lot rounding can leave a small shortfall.
    # The quote-denominated tolerance covers small positions where a percentage
    # alone would be smaller than exchange dust. Account surplus is always safe.
    stable_quote = canonical_symbol(symbol).split("@", 1)[0].endswith(
        ("/USDT", "/USDC", "/USD")
    )
    relative_tolerance = 0.0
    if stable_quote:
        relative_tolerance = min(
            0.02,
            max(
                DEFAULT_DRIFT_RELATIVE_TOLERANCE,
                float(shortfall_relative_tolerance or 0.0),
            ),
        )
    tolerance = max(
        1e-8,
        expected * relative_tolerance,
        max(0.0, float(absolute_tolerance or 0.0)),
        quote_drift_tolerance(symbol, reference_price),
    )
    if unknown >= -(tolerance + 1e-12):
        status = STATUS_OK
        reason = ""
        allowed = True
    else:
        status = STATUS_BLOCKED
        reason = "account_below_strategy_allocation"
        allowed = False
    should_log = status == STATUS_BLOCKED and (
        str(previous_status or "") != STATUS_BLOCKED
        or str(previous_reason or "") != reason
    )
    return OwnershipSnapshot(
        symbol=canonical_symbol(symbol),
        side=normalize_side(side),
        account_qty=account,
        strategy_qty=strategy,
        protected_qty=protected,
        expected_qty=expected,
        unknown_qty=unknown,
        tolerance=tolerance,
        coexistence_mode=mode,
        status=status,
        reason=reason,
        allowed=allowed,
        should_log=should_log,
    )


def _fetch_reservation(
    *,
    user_id: int,
    credential_id: int,
    market_type: str,
    symbol: str,
    side: str,
) -> Dict[str, Any]:
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT * FROM qd_position_reservations
            WHERE user_id = %s AND credential_id = %s AND market_type = %s
              AND symbol_canonical = %s AND side = %s
            LIMIT 1
            """,
            (
                int(user_id or 0),
                int(credential_id or 0),
                normalize_market_type(market_type),
                canonical_symbol(symbol),
                normalize_side(side),
            ),
        )
        row = cur.fetchone() or {}
        cur.close()
    return dict(row)


def evaluate_and_record_ownership(
    *,
    user_id: int,
    credential_id: int,
    exchange_id: str,
    market_type: str,
    symbol: str,
    side: str,
    account_qty: float,
    strategy_qty: float,
    inst_id: str = "",
    absolute_tolerance: float = 0.0,
    shortfall_relative_tolerance: float = DEFAULT_SHORTFALL_RELATIVE_TOLERANCE,
) -> OwnershipSnapshot:
    """Evaluate one leg and persist its block/recovery state atomically enough for workers."""
    row = _fetch_reservation(
        user_id=user_id,
        credential_id=credential_id,
        market_type=market_type,
        symbol=symbol,
        side=side,
    )
    snapshot = calculate_position_ownership(
        symbol=symbol,
        side=side,
        account_qty=account_qty,
        strategy_qty=strategy_qty,
        protected_qty=float(row.get("manual_reserved_qty") or 0.0),
        coexistence_mode=str(row.get("coexistence_mode") or STRICT_MODE),
        previous_status=str(row.get("status") or ""),
        previous_reason=str(row.get("drift_reason") or ""),
        absolute_tolerance=float(absolute_tolerance or 0.0),
        shortfall_relative_tolerance=float(shortfall_relative_tolerance or 0.0),
    )
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO qd_position_reservations
              (user_id, credential_id, exchange_id, market_type, inst_id, symbol,
               symbol_canonical, side, coexistence_mode, manual_reserved_qty,
               observed_account_qty, allocated_qty, status, drift_reason,
               last_log_at, created_at, updated_at)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
               CASE WHEN %s THEN NOW() ELSE NULL END, NOW(), NOW())
            ON CONFLICT (user_id, credential_id, market_type, symbol_canonical, side)
            DO UPDATE SET
              exchange_id = excluded.exchange_id,
              inst_id = CASE WHEN excluded.inst_id <> '' THEN excluded.inst_id ELSE qd_position_reservations.inst_id END,
              symbol = excluded.symbol,
              observed_account_qty = excluded.observed_account_qty,
              allocated_qty = excluded.allocated_qty,
              status = excluded.status,
              drift_reason = excluded.drift_reason,
              last_log_at = CASE WHEN %s THEN NOW() ELSE qd_position_reservations.last_log_at END,
              updated_at = NOW()
            """,
            (
                int(user_id or 0),
                int(credential_id or 0),
                str(exchange_id or "").strip().lower(),
                normalize_market_type(market_type),
                str(inst_id or "").strip(),
                normalize_strategy_symbol(symbol),
                snapshot.symbol,
                snapshot.side,
                snapshot.coexistence_mode,
                snapshot.protected_qty,
                snapshot.account_qty,
                snapshot.strategy_qty,
                snapshot.status,
                snapshot.reason,
                bool(snapshot.should_log),
                bool(snapshot.should_log),
            ),
        )
        db.commit()
        cur.close()
    return snapshot


def is_position_leg_blocked(
    *,
    user_id: int,
    credential_id: int,
    market_type: str,
    symbol: str,
    side: str,
) -> bool:
    """Fast queue-boundary check; exits intentionally never call this."""
    row = _fetch_reservation(
        user_id=user_id,
        credential_id=credential_id,
        market_type=market_type,
        symbol=symbol,
        side=side,
    )
    if str(row.get("status") or "") != STATUS_BLOCKED:
        return False
    # Older releases persisted account surplus as an unallocated-position
    # block. That state is obsolete under automatic user ownership and must not
    # prevent the order worker from refreshing the live allocation snapshot.
    return str(row.get("drift_reason") or "") in {
        "account_below_strategy_allocation",
        "account_below_protected_allocation",
    }


def protected_quantity(
    *,
    user_id: int,
    credential_id: int,
    market_type: str,
    symbol: str,
    side: str,
) -> float:
    """Return the last observed account surplus for compatibility and display."""
    row = _fetch_reservation(
        user_id=user_id,
        credential_id=credential_id,
        market_type=market_type,
        symbol=symbol,
        side=side,
    )
    return max(
        0.0,
        float(row.get("observed_account_qty") or 0.0)
        - float(row.get("allocated_qty") or 0.0),
    )


def repair_position_ownership(
    *,
    user_id: int,
    credential_id: int,
    exchange_id: str,
    market_type: str,
    symbol: str,
    side: str,
    account_qty: float,
    strategy_qty: float,
    action: str,
    inst_id: str = "",
    reference_price: float = 0.0,
) -> OwnershipSnapshot:
    """Apply an explicit user repair action and return the resulting snapshot."""
    if not all(math.isfinite(float(value or 0)) for value in (account_qty, strategy_qty, reference_price)):
        raise ValueError("positionOwnership.snapshotUnavailable")
    if str(exchange_id or "").lower() == "alpaca":
        market_type = "spot"
    action_name = str(action or "").strip().lower()
    if action_name not in {"protect_manual", "reset_protection", "strict_mode", "recheck"}:
        raise ValueError("positionOwnership.invalidRepairAction")
    if action_name in {"protect_manual", "reset_protection"} and not supports_position_coexistence(
        market_type, exchange_id
    ):
        raise ValueError("positionOwnership.coexistenceMarketUnsupported")
    existing = _fetch_reservation(
        user_id=user_id,
        credential_id=credential_id,
        market_type=market_type,
        symbol=symbol,
        side=side,
    )
    mode = str(existing.get("coexistence_mode") or STRICT_MODE)
    manual = max(0.0, float(account_qty or 0.0) - float(strategy_qty or 0.0))
    if action_name in {"protect_manual", "reset_protection"}:
        if action_name == "reset_protection" and mode != ADVANCED_MODE:
            raise ValueError("positionOwnership.invalidRepairAction")
        if float(account_qty or 0.0) + 1e-8 < float(strategy_qty or 0.0):
            raise ValueError("positionOwnership.accountBelowStrategyAllocation")
        mode = ADVANCED_MODE
    elif action_name == "strict_mode":
        mode = STRICT_MODE

    snapshot = calculate_position_ownership(
        symbol=symbol,
        side=side,
        account_qty=account_qty,
        strategy_qty=strategy_qty,
        protected_qty=manual,
        coexistence_mode=mode,
        reference_price=reference_price,
    )
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO qd_position_reservations
              (user_id, credential_id, exchange_id, market_type, inst_id, symbol,
               symbol_canonical, side, coexistence_mode, manual_reserved_qty,
               observed_account_qty, allocated_qty, status, drift_reason,
               created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (user_id, credential_id, market_type, symbol_canonical, side)
            DO UPDATE SET
              exchange_id = excluded.exchange_id,
              inst_id = CASE WHEN excluded.inst_id <> '' THEN excluded.inst_id ELSE qd_position_reservations.inst_id END,
              symbol = excluded.symbol,
              coexistence_mode = excluded.coexistence_mode,
              manual_reserved_qty = excluded.manual_reserved_qty,
              observed_account_qty = excluded.observed_account_qty,
              allocated_qty = excluded.allocated_qty,
              status = excluded.status,
              drift_reason = excluded.drift_reason,
              last_log_at = NULL,
              updated_at = NOW()
            """,
            (
                int(user_id or 0), int(credential_id or 0), str(exchange_id or "").lower(),
                normalize_market_type(market_type), str(inst_id or ""),
                normalize_strategy_symbol(symbol), snapshot.symbol, snapshot.side,
                mode, manual, snapshot.account_qty, snapshot.strategy_qty,
                snapshot.status, snapshot.reason,
            ),
        )
        db.commit()
        cur.close()
    return snapshot


def list_reservations(
    *, user_id: int, credential_id: int, market_type: str
) -> List[Dict[str, Any]]:
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT * FROM qd_position_reservations
            WHERE user_id = %s AND credential_id = %s AND market_type = %s
            ORDER BY symbol_canonical, side
            """,
            (int(user_id or 0), int(credential_id or 0), normalize_market_type(market_type)),
        )
        rows = [dict(row) for row in (cur.fetchall() or [])]
        cur.close()
    return rows


def build_ownership_rows(
    *,
    account_rows: Iterable[Dict[str, Any]],
    allocated_rows: Iterable[Dict[str, Any]],
    reservation_rows: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Build UI/API rows without mutating ownership state."""
    def aggregate(rows: Iterable[Dict[str, Any]]) -> Dict[Tuple[str, str], float]:
        values: Dict[Tuple[str, str], float] = {}
        for row in rows or []:
            key = (canonical_symbol(row.get("symbol") or row.get("symbol_canonical") or ""), normalize_side(row.get("side") or ""))
            if not key[0] or not key[1]:
                continue
            values[key] = values.get(key, 0.0) + max(0.0, float(row.get("size") or 0.0))
        return values

    account_rows = list(account_rows)
    allocated_rows = list(allocated_rows)
    prices = {}
    for row in account_rows + allocated_rows:
        price = float(row.get("mark_price") or row.get("current_price") or 0.0)
        if math.isfinite(price) and price > 0:
            prices[canonical_symbol(row.get("symbol") or "")] = price
    account = aggregate(account_rows)
    allocated = aggregate(allocated_rows)
    reservations = {
        (canonical_symbol(row.get("symbol_canonical") or row.get("symbol") or ""), normalize_side(row.get("side") or "")): row
        for row in reservation_rows or []
    }
    output: List[Dict[str, Any]] = []
    for key in sorted(set(account) | set(allocated) | set(reservations)):
        row = reservations.get(key) or {}
        snap = calculate_position_ownership(
            symbol=key[0], side=key[1], account_qty=account.get(key, 0.0),
            strategy_qty=allocated.get(key, 0.0),
            protected_qty=float(row.get("manual_reserved_qty") or 0.0),
            coexistence_mode=str(row.get("coexistence_mode") or STRICT_MODE),
            reference_price=prices.get(key[0], 0.0),
        )
        item = snap.metadata()
        item["inst_id"] = str(row.get("inst_id") or "")
        item["updated_at"] = row.get("updated_at")
        item["reference_price"] = prices.get(key[0], 0.0)
        item["difference_quote"] = snap.unknown_qty * prices[key[0]] if key[0] in prices else None
        item["repair_kind"] = (
            "none" if snap.allowed else "allocation_shortfall"
        )
        item["allocations"] = [
            {"strategy_id": allocation.get("strategy_id"), "strategy_name": allocation.get("strategy_name"),
             "status": allocation.get("status"), "quantity": float(allocation.get("size") or 0.0)}
            for allocation in allocated_rows
            if canonical_symbol(allocation.get("symbol") or "") == key[0]
            and normalize_side(allocation.get("side") or "") == key[1]
        ]
        output.append(item)
    return output


def ownership_log_message(snapshot: OwnershipSnapshot) -> str:
    return (
        f"Position ownership drift blocked new entries: {snapshot.symbol} {snapshot.side}; "
        f"account={format_decimal(snapshot.account_qty)}, "
        f"strategy={format_decimal(snapshot.strategy_qty)}, "
        f"protected={format_decimal(snapshot.protected_qty)}, "
        f"unknown={format_decimal(snapshot.unknown_qty)}, "
        f"mode={snapshot.coexistence_mode}, reason={snapshot.reason}. "
        "Reduce-only exits remain enabled."
    )
