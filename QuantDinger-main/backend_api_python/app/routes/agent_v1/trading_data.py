"""Read-only broker account and execution-ledger observations."""
from __future__ import annotations

import json

from flask import request

from app.services.live_trading.account_positions import list_account_positions
from app.services.live_trading.account_snapshot import fetch_account_snapshot
from app.services.live_trading.factory import (
    exchange_demo_mode_enabled,
    exchange_market_scope,
    exchange_trading_environment,
)
from app.utils.agent_auth import SCOPE_R, agent_required, current_user_id
from app.utils.credential_crypto import decrypt_credential_blob
from app.utils.db import get_db_connection

from . import agent_v1_bp
from ._helpers import clip_int, envelope, error


def _credential(credential_id: int):
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT id, name, exchange_id, api_key_hint, encrypted_config, created_at, updated_at
            FROM qd_exchange_credentials
            WHERE id = %s AND user_id = %s
            """,
            (int(credential_id), current_user_id()),
        )
        row = cur.fetchone()
        cur.close()
    return row


def _safe_credential(row: dict) -> dict:
    config = {}
    try:
        plain = decrypt_credential_blob(row.get("encrypted_config"))
        config = json.loads(plain) if plain else {}
        if not isinstance(config, dict):
            config = {}
    except Exception:
        config = {}
    exchange_id = str(row.get("exchange_id") or "")
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "exchange_id": exchange_id,
        "api_key_hint": row.get("api_key_hint") or "",
        "environment": exchange_trading_environment(config, exchange_id),
        "market_scope": exchange_market_scope(config),
        "enable_demo_trading": exchange_demo_mode_enabled(config),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


@agent_v1_bp.route("/trading/accounts", methods=["GET"])
@agent_required(SCOPE_R)
def list_trading_accounts():
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT id, name, exchange_id, api_key_hint, encrypted_config, created_at, updated_at
            FROM qd_exchange_credentials
            WHERE user_id = %s
            ORDER BY id DESC
            """,
            (current_user_id(),),
        )
        rows = cur.fetchall() or []
        cur.close()
    return envelope([_safe_credential(row) for row in rows])


@agent_v1_bp.route("/trading/accounts/<int:credential_id>/snapshot", methods=["GET"])
@agent_required(SCOPE_R)
def get_trading_account_snapshot(credential_id: int):
    if not _credential(credential_id):
        return error(404, "Credential not found", http=404)
    return envelope(fetch_account_snapshot(user_id=current_user_id(), credential_id=credential_id))


@agent_v1_bp.route("/trading/accounts/<int:credential_id>/positions", methods=["GET"])
@agent_required(SCOPE_R)
def get_trading_account_positions(credential_id: int):
    if not _credential(credential_id):
        return error(404, "Credential not found", http=404)
    rows = list_account_positions(
        user_id=current_user_id(),
        credential_id=credential_id,
        market_type=(request.args.get("market_type") or "").strip() or None,
    )
    return envelope(rows)


@agent_v1_bp.route("/trading/strategies/<int:strategy_id>/positions", methods=["GET"])
@agent_required(SCOPE_R)
def get_strategy_positions(strategy_id: int):
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT id, symbol, symbol_canonical, side, size, entry_price,
                   current_price, unrealized_pnl, pnl_percent, equity,
                   market_type, credential_id, inst_id, strategy_run_id, updated_at
            FROM qd_strategy_positions
            WHERE user_id = %s AND strategy_id = %s
            ORDER BY id DESC
            """,
            (current_user_id(), strategy_id),
        )
        rows = cur.fetchall() or []
        cur.close()
    return envelope(rows)


@agent_v1_bp.route("/trading/strategies/<int:strategy_id>/trades", methods=["GET"])
@agent_required(SCOPE_R)
def get_strategy_trades(strategy_id: int):
    limit = clip_int(request.args.get("limit"), default=50, lo=1, hi=200)
    cursor = clip_int(request.args.get("cursor"), default=0, lo=0, hi=2_147_483_647)
    with get_db_connection() as db:
        cur = db.cursor()
        params = [current_user_id(), strategy_id]
        cursor_sql = ""
        if cursor:
            cursor_sql = " AND id < %s"
            params.append(cursor)
        params.append(limit + 1)
        cur.execute(
            f"""
            SELECT id, symbol, symbol_canonical, type, price, amount, value,
                   commission, commission_ccy, commission_quote, profit,
                   close_reason, market_type, credential_id, inst_id,
                   fill_source, strategy_run_id, created_at
            FROM qd_strategy_trades
            WHERE user_id = %s AND strategy_id = %s{cursor_sql}
            ORDER BY id DESC LIMIT %s
            """,
            params,
        )
        rows = cur.fetchall() or []
        cur.close()
    has_more = len(rows) > limit
    items = rows[:limit]
    return envelope({
        "items": items,
        "next_cursor": items[-1]["id"] if has_more and items else None,
    })


@agent_v1_bp.route("/trading/strategies/<int:strategy_id>/pending-orders", methods=["GET"])
@agent_required(SCOPE_R)
def get_strategy_pending_orders(strategy_id: int):
    limit = clip_int(request.args.get("limit"), default=50, lo=1, hi=200)
    cursor = clip_int(request.args.get("cursor"), default=0, lo=0, hi=2_147_483_647)
    with get_db_connection() as db:
        cur = db.cursor()
        params = [current_user_id(), strategy_id]
        cursor_sql = ""
        if cursor:
            cursor_sql = " AND id < %s"
            params.append(cursor)
        params.append(limit + 1)
        cur.execute(
            f"""
            SELECT id, symbol, signal_type, signal_ts, market_type, order_type,
                   amount, price, execution_mode, status, attempts, max_attempts,
                   last_error, exchange_id, credential_id, inst_id,
                   exchange_order_id, filled, avg_price, strategy_run_id,
                   created_at, updated_at
            FROM pending_orders
            WHERE user_id = %s AND strategy_id = %s{cursor_sql}
            ORDER BY id DESC LIMIT %s
            """,
            params,
        )
        rows = cur.fetchall() or []
        cur.close()
    has_more = len(rows) > limit
    items = rows[:limit]
    return envelope({
        "items": items,
        "next_cursor": items[-1]["id"] if has_more and items else None,
    })


@agent_v1_bp.route("/trading/quick-trades", methods=["GET"])
@agent_required(SCOPE_R)
def list_agent_quick_trades():
    limit = clip_int(request.args.get("limit"), default=50, lo=1, hi=200)
    cursor = clip_int(request.args.get("cursor"), default=0, lo=0, hi=2_147_483_647)
    with get_db_connection() as db:
        cur = db.cursor()
        params = [current_user_id()]
        cursor_sql = ""
        if cursor:
            cursor_sql = " AND id < %s"
            params.append(cursor)
        params.append(limit + 1)
        cur.execute(
            f"""
            SELECT id, credential_id, exchange_id, symbol, side, order_type,
                   amount, price, leverage, market_type, status,
                   exchange_order_id, filled_amount, avg_fill_price,
                   commission, commission_ccy, error_msg, source, created_at
            FROM qd_quick_trades
            WHERE user_id = %s AND source = 'agent_mcp'{cursor_sql}
            ORDER BY id DESC LIMIT %s
            """,
            params,
        )
        rows = cur.fetchall() or []
        cur.close()
    has_more = len(rows) > limit
    items = rows[:limit]
    return envelope({
        "items": items,
        "next_cursor": items[-1]["id"] if has_more and items else None,
    })
