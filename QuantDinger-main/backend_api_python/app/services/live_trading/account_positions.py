"""
L1 account position mirror — exchange truth keyed by credential + market_type + inst_id.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.services.live_trading.records import normalize_strategy_symbol
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class AccountLegSnapshot:
    symbol: str
    side: str
    size: float
    entry_price: float = 0.0
    mark_price: float = 0.0
    inst_id: str = ""


def sync_account_positions(
    *,
    user_id: int,
    credential_id: int,
    exchange_id: str,
    market_type: str,
    legs: List[AccountLegSnapshot],
) -> None:
    """
    Replace L1 rows for (credential_id, market_type) with the latest exchange snapshot.
    """
    cred = int(credential_id or 0)
    if cred <= 0:
        return
    mt = str(market_type or "swap").strip().lower()
    if mt in ("futures", "future", "perp", "perpetual"):
        mt = "swap"
    uid = int(user_id or 1)
    ex = str(exchange_id or "").strip().lower()

    active_keys: List[tuple] = []
    with get_db_connection() as db:
        cur = db.cursor()
        for leg in legs or []:
            sym = normalize_strategy_symbol(leg.symbol) or str(leg.symbol or "").strip()
            side = str(leg.side or "").strip().lower()
            try:
                sz = float(leg.size or 0.0)
            except Exception:
                sz = 0.0
            if not sym or side not in ("long", "short") or sz <= 1e-12:
                continue
            iid = str(leg.inst_id or "").strip()
            if not iid:
                from app.services.live_trading.leg_context import inst_id_for_symbol

                iid = inst_id_for_symbol(sym, mt, ex)
            key = (cred, mt, iid, side)
            active_keys.append(key)
            cur.execute(
                """
                INSERT INTO qd_account_positions
                (user_id, credential_id, exchange_id, market_type, inst_id, symbol, side,
                 size, entry_price, mark_price, synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (credential_id, market_type, inst_id, side) DO UPDATE SET
                    user_id = excluded.user_id,
                    exchange_id = excluded.exchange_id,
                    symbol = excluded.symbol,
                    size = excluded.size,
                    entry_price = excluded.entry_price,
                    mark_price = excluded.mark_price,
                    synced_at = NOW()
                """,
                (
                    uid,
                    cred,
                    ex,
                    mt,
                    iid,
                    sym,
                    side,
                    sz,
                    float(leg.entry_price or 0.0),
                    float(leg.mark_price or 0.0),
                ),
            )

        # Drop legs that are flat on exchange for this credential/market bucket.
        if active_keys:
            clauses = []
            params: List[Any] = [cred, mt]
            for _cred, _mt, iid, side in active_keys:
                clauses.append("(inst_id = %s AND side = %s)")
                params.extend([iid, side])
            cur.execute(
                f"""
                DELETE FROM qd_account_positions
                WHERE credential_id = %s AND market_type = %s
                  AND NOT ({' OR '.join(clauses)})
                """,
                params,
            )
        else:
            cur.execute(
                "DELETE FROM qd_account_positions WHERE credential_id = %s AND market_type = %s",
                (cred, mt),
            )
        db.commit()
        cur.close()


def account_legs_from_exchange_maps(
    exch_size: Dict[str, Dict[str, float]],
    exch_entry_price: Dict[str, Dict[str, float]],
    inst_id_map: Optional[Dict[str, Dict[str, str]]] = None,
) -> List[AccountLegSnapshot]:
    legs: List[AccountLegSnapshot] = []
    inst_id_map = inst_id_map or {}
    for sym_key, sides in (exch_size or {}).items():
        sym = normalize_strategy_symbol(str(sym_key or "")) or str(sym_key or "").strip()
        for side in ("long", "short"):
            try:
                sz = float((sides or {}).get(side) or 0.0)
            except Exception:
                sz = 0.0
            if sz <= 1e-12:
                continue
            ep = float((exch_entry_price.get(sym_key) or {}).get(side) or 0.0)
            iid = str((inst_id_map.get(sym_key) or inst_id_map.get(sym) or {}).get(side) or "")
            legs.append(
                AccountLegSnapshot(
                    symbol=sym,
                    side=side,
                    size=sz,
                    entry_price=ep,
                    inst_id=iid,
                )
            )
    return legs


def list_account_positions(
    *,
    user_id: int,
    credential_id: Optional[int] = None,
    market_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    uid = int(user_id or 0)
    if uid <= 0:
        return []
    clauses = ["user_id = %s"]
    params: List[Any] = [uid]
    if credential_id is not None and int(credential_id) > 0:
        clauses.append("credential_id = %s")
        params.append(int(credential_id))
    if market_type:
        mt = str(market_type).strip().lower()
        if mt in ("futures", "future", "perp", "perpetual"):
            mt = "swap"
        clauses.append("market_type = %s")
        params.append(mt)
    sql = f"""
        SELECT id, credential_id, exchange_id, market_type, inst_id, symbol, side,
               size, entry_price, mark_price, synced_at
        FROM qd_account_positions
        WHERE {' AND '.join(clauses)}
        ORDER BY symbol, side
    """
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall() or []
        cur.close()
    return [dict(r) for r in rows]


def filter_position_rows_by_symbols(
    rows: List[Dict[str, Any]], allowed_symbols: Optional[List[str]]
) -> List[Dict[str, Any]]:
    """Keep account/ownership rows inside the current strategy universe."""
    allowed = {
        normalize_strategy_symbol(str(symbol or "")).upper()
        for symbol in (allowed_symbols or [])
        if normalize_strategy_symbol(str(symbol or ""))
    }
    if not allowed:
        return list(rows or [])
    return [
        row
        for row in (rows or [])
        if normalize_strategy_symbol(
            str(row.get("symbol_canonical") or row.get("symbol") or "")
        ).upper()
        in allowed
    ]


def reconcile_strategy_vs_account(
    local_rows: List[Dict[str, Any]],
    account_rows: List[Dict[str, Any]],
    *,
    allocated_rows: Optional[List[Dict[str, Any]]] = None,
    protected_rows: Optional[List[Dict[str, Any]]] = None,
    eps: float = 1e-8,
    size_tolerance_ratio: float = 0.005,
) -> Dict[str, Any]:
    """
    Compare L3 strategy snapshot vs L1 account mirror for the same symbols.

    Account surplus is user-owned inventory and therefore reconciles as ``ok``.
    Returns ``{status, notes}`` where status is one of:
    ok | strategy_only | mismatch
    """
    def aggregate(rows: List[Dict[str, Any]]) -> Dict[tuple, float]:
        output: Dict[tuple, float] = {}
        for r in rows or []:
            sym = normalize_strategy_symbol(str(r.get("symbol") or "")).upper()
            side = str(r.get("side") or "").strip().lower()
            if not sym or side not in ("long", "short"):
                continue
            try:
                sz = float(r.get("size") or 0.0)
            except Exception:
                sz = 0.0
            if sz <= eps:
                continue
            output[(sym, side)] = output.get((sym, side), 0.0) + sz
        return output

    local: Dict[tuple, float] = aggregate(local_rows or [])
    allocations: Dict[tuple, float] = aggregate(
        allocated_rows if allocated_rows is not None else (local_rows or [])
    )
    include_ownership = protected_rows is not None
    acct: Dict[tuple, float] = aggregate(account_rows or [])
    from app.services.live_trading.position_ownership import quote_drift_tolerance

    prices = {}
    for row in (account_rows or []) + (local_rows or []):
        price = float(row.get("mark_price") or row.get("current_price") or 0.0)
        if price > 0:
            prices[normalize_strategy_symbol(str(row.get("symbol") or "")).upper()] = price

    notes: List[str] = []
    status = "ok"
    for key in set(allocations.keys()) | set(acct.keys()):
        allocated_size = float(allocations.get(key, 0.0))
        account_size = float(acct.get(key, 0.0))
        protected_size = max(0.0, account_size - allocated_size)
        expected_size = allocated_size
        sym, side = key
        stable_quote = sym.split("@", 1)[0].endswith(("/USDT", "/USDC", "/USD"))
        tol = max(
            eps,
            expected_size * size_tolerance_ratio if stable_quote else 0.0,
            quote_drift_tolerance(sym, prices.get(sym, 0.0)),
        )
        if account_size >= expected_size or expected_size - account_size <= tol:
            continue
        if expected_size <= eps and account_size <= eps:
            continue
        if expected_size > eps and account_size <= eps:
            note = f"strategy_only:{sym}:{side}:allocated={allocated_size}"
            if include_ownership:
                note = (
                    f"strategy_only:{sym}:{side}:strategy={allocated_size}:"
                    f"protected={protected_size}:account=0"
                )
            notes.append(note)
            status = "strategy_only" if status == "ok" else "mismatch"
        else:
            if expected_size - account_size > tol:
                note = f"size_mismatch:{sym}:{side}:allocated={allocated_size}:account={account_size}"
                if include_ownership:
                    note = (
                        f"size_mismatch:{sym}:{side}:account={account_size}:strategy={allocated_size}:"
                        f"protected={protected_size}:unknown={account_size - expected_size}"
                    )
                notes.append(note)
                status = "mismatch"

    shares: List[Dict[str, Any]] = []
    for key, local_size in sorted(local.items()):
        sym, side = key
        allocated_size = float(allocations.get(key, 0.0))
        account_size = float(acct.get(key, 0.0))
        protected_size = max(0.0, account_size - allocated_size)
        share = {
            "symbol": sym,
            "side": side,
            "strategy_size": local_size,
            "allocated_size": allocated_size,
            "account_size": account_size,
            "allocation_share": local_size / allocated_size if allocated_size > eps else 0.0,
        }
        if include_ownership:
            share["protected_size"] = protected_size
        shares.append(share)
    return {
        "status": status,
        "notes": notes,
        "strategy_allocations": shares,
    }


def list_strategy_allocations_for_account(
    *,
    user_id: int,
    credential_id: int,
    market_type: str,
    allowed_symbols: Optional[set] = None,
    exchange_id: str = "",
) -> List[Dict[str, Any]]:
    """List all strategy-owned legs for one credential and market."""
    mt = str(market_type or "swap").strip().lower()
    if mt in ("future", "futures", "perp", "perpetual"):
        mt = "swap"
    market_types = [mt]
    if str(exchange_id).lower() == "alpaca":
        # Historical Alpaca fills used asset classes instead of the spot bucket.
        market_types = ["spot", "usstock", "crypto"]
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT p.strategy_id, s.strategy_name, s.status, p.symbol, p.side, p.size
            FROM qd_strategy_positions p
            JOIN qd_strategies_trading s ON s.id = p.strategy_id
            WHERE s.user_id = %s AND s.execution_mode = 'live'
              AND LOWER(p.market_type) = ANY(%s) AND p.size > 0
              AND (p.credential_id = %s OR %s = 0
                   OR (COALESCE(p.credential_id, 0) = 0
                       AND COALESCE(NULLIF(s.exchange_config::jsonb->>'credential_id', ''),
                                    s.exchange_config::jsonb->>'credentials_id') = %s))
            """,
            (int(user_id), market_types, int(credential_id or 0), int(credential_id or 0), str(credential_id or 0)),
        )
        rows = [dict(row) for row in (cur.fetchall() or [])]
        cur.close()
    if not allowed_symbols:
        return rows
    allowed = {normalize_strategy_symbol(str(symbol or "")).upper() for symbol in allowed_symbols if symbol}
    return [
        row for row in rows
        if normalize_strategy_symbol(str(row.get("symbol") or "")).upper() in allowed
    ]


def snapshot_rows_to_account_legs(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize ``fetch_account_snapshot`` position rows for strategy UI."""
    out: List[Dict[str, Any]] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        sym = normalize_strategy_symbol(str(r.get("symbol") or "")) or str(r.get("symbol") or "").strip()
        side = str(r.get("side") or "long").strip().lower()
        try:
            size = float(r.get("size") or 0.0)
        except Exception:
            size = 0.0
        if not sym or side not in ("long", "short") or size <= 1e-12:
            continue
        mt = str(r.get("market_type") or "swap").strip().lower()
        if mt in ("futures", "future", "perp", "perpetual"):
            mt = "swap"
        out.append(
            {
                "symbol": sym,
                "side": side,
                "size": size,
                "entry_price": float(r.get("entry_price") or 0.0),
                "mark_price": float(r.get("mark_price") or 0.0),
                "market_type": mt,
                "inst_id": str(r.get("inst_id") or ""),
            }
        )
    return out


def filter_legs_by_symbols(
    legs: List[Dict[str, Any]],
    allowed_symbols: Optional[set],
) -> List[Dict[str, Any]]:
    if not allowed_symbols:
        return list(legs or [])
    allowed = {normalize_strategy_symbol(s).upper() for s in allowed_symbols if s}
    out: List[Dict[str, Any]] = []
    for leg in legs or []:
        sym = normalize_strategy_symbol(str(leg.get("symbol") or "")).upper()
        if sym in allowed:
            out.append(leg)
    return out


def live_account_mirror_for_strategy(
    *,
    strategy_id: int,
    user_id: int,
    strategy_market_type: str = "swap",
    allowed_symbols: Optional[set] = None,
) -> Dict[str, Any]:
    """
    Live fetch swap + spot legs for a strategy credential (same source as broker account modal).

    ``account_legs`` includes both buckets so the trading-robot mirror matches
    ``/account/snapshot``. ``reconcile_legs`` contains only the legs that match
    the strategy's ``market_type`` (used for L3 vs exchange reconciliation).
    """
    from app.services.live_trading.account_snapshot import fetch_account_snapshot
    from app.services.live_trading.leg_context import resolve_leg_context

    ctx = resolve_leg_context(strategy_id=int(strategy_id))
    cred = int(ctx.credential_id or 0)
    if cred <= 0:
        return {
            "account_legs": [],
            "swap_legs": [],
            "spot_legs": [],
            "reconcile_legs": [],
            "fetched_at": 0,
            "warnings": [],
            "source": "missing_credential",
        }

    smt = str(strategy_market_type or ctx.normalized_market_type() or "swap").strip().lower()
    if smt in ("futures", "future", "perp", "perpetual"):
        smt = "swap"

    snap = fetch_account_snapshot(user_id=int(user_id), credential_id=cred)
    swap_legs = snapshot_rows_to_account_legs(snap.get("swap_positions") or [])
    spot_legs = snapshot_rows_to_account_legs(snap.get("spot_positions") or [])
    account_legs = swap_legs + spot_legs
    reconcile_legs = spot_legs if smt == "spot" else swap_legs
    reconcile_legs = filter_legs_by_symbols(reconcile_legs, allowed_symbols)

    return {
        "account_legs": account_legs,
        "swap_legs": swap_legs,
        "spot_legs": spot_legs,
        "reconcile_legs": reconcile_legs,
        "fetched_at": int(snap.get("fetched_at") or 0),
        "warnings": list(snap.get("warnings") or []),
        "source": "live_snapshot",
    }


def list_account_positions_for_strategy(
    *,
    strategy_id: int,
    user_id: int,
    allowed_symbols: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Filter L1 legs to symbols this strategy is configured to trade."""
    from app.services.live_trading.leg_context import resolve_leg_context

    ctx = resolve_leg_context(strategy_id=int(strategy_id))
    if ctx.credential_id <= 0:
        return []
    rows = list_account_positions(
        user_id=int(user_id),
        credential_id=ctx.credential_id,
        market_type=ctx.market_type,
    )
    if not allowed_symbols:
        return rows
    allowed = {normalize_strategy_symbol(s).upper() for s in allowed_symbols if s}
    out = []
    for r in rows:
        sym = normalize_strategy_symbol(str(r.get("symbol") or "")).upper()
        if sym in allowed:
            out.append(r)
    return out
