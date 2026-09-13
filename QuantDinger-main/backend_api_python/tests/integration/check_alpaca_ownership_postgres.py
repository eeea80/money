"""Opt-in isolated PostgreSQL check; never touches account data or a broker.

Set DATABASE_URL and optionally RELEASE_SOURCE_DIR containing candidate modules.
"""

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor


def candidate(name):
    directory = os.environ.get("RELEASE_SOURCE_DIR")
    if not directory:
        return importlib.import_module(name)
    path = Path(directory) / (name.rsplit(".", 1)[-1] + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    from app.utils.db_postgres import PostgresCursor
    positions = candidate("app.services.live_trading.account_positions")
    ownership = candidate("app.services.live_trading.position_ownership")
    guard = candidate("app.services.live_trading.alpaca_ownership")
    schema = "qd_alpaca_protection_test_" + uuid4().hex
    credential = 1000000000 + (uuid4().int % 1000000000)
    dsn = os.environ["DATABASE_URL"]
    admin = psycopg2.connect(dsn)
    admin.autocommit = True

    class Connection:
        def __init__(self, native):
            self.native = native

        def cursor(self):
            return PostgresCursor(self.native.cursor(cursor_factory=RealDictCursor))

        def commit(self):
            self.native.commit()

        def rollback(self):
            self.native.rollback()

    @contextmanager
    def connect():
        native = psycopg2.connect(dsn)
        try:
            with native.cursor() as cur:
                cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            yield Connection(native)
        finally:
            native.rollback()
            native.close()

    def query(statement, params=()):
        with connect() as db:
            cur = db.cursor()
            cur.execute(statement, params)
            rows = cur.fetchall() if cur._cursor.description else []
            db.commit()
            return rows

    for module in (positions, ownership, guard):
        module.get_db_connection = connect
    try:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        query("""
            CREATE TABLE qd_strategies_trading(id BIGINT PRIMARY KEY, user_id BIGINT,
                strategy_name TEXT, status TEXT, execution_mode TEXT, exchange_config JSONB);
            CREATE TABLE qd_strategy_positions(strategy_id BIGINT, symbol TEXT, side TEXT,
                size NUMERIC, market_type TEXT, credential_id BIGINT);
            CREATE TABLE pending_orders(id BIGINT, strategy_id BIGINT, credential_id BIGINT,
                symbol TEXT, status TEXT, filled NUMERIC DEFAULT 0);
            CREATE TABLE qd_strategy_trades(pending_order_id BIGINT, amount NUMERIC);
            CREATE TABLE qd_position_reservations(user_id BIGINT, credential_id BIGINT,
                exchange_id TEXT, market_type TEXT, inst_id TEXT, symbol TEXT,
                symbol_canonical TEXT, side TEXT, coexistence_mode TEXT, manual_reserved_qty NUMERIC,
                observed_account_qty NUMERIC, allocated_qty NUMERIC, status TEXT, drift_reason TEXT,
                created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, last_log_at TIMESTAMPTZ,
                UNIQUE(user_id, credential_id, market_type, symbol_canonical, side));
        """)
        for sid, uid, cred, qty, market in [(1, 7, credential, 10, "USStock"),
                                           (2, 7, credential, 4, "spot"),
                                           (3, 8, credential, 1000, "spot"),
                                           (4, 7, credential + 1, 1000, "spot")]:
            query("INSERT INTO qd_strategies_trading VALUES (%s,%s,'test','running','live',%s)",
                  (sid, uid, json.dumps({"credential_id": cred})))
            query("INSERT INTO qd_strategy_positions VALUES (%s,'NVDA','long',%s,%s,%s)",
                  (sid, qty, market, 0 if sid == 1 else cred))
        allocated = positions.list_strategy_allocations_for_account(
            user_id=7, credential_id=credential, market_type="spot", exchange_id="alpaca",
            allowed_symbols={"NVDA"})
        assert {row["strategy_id"] for row in allocated} == {1, 2}, allocated
        manual = 907.768327
        with guard.alpaca_account_lock(credential):
            snapshot = ownership.repair_position_ownership(
                user_id=7, credential_id=credential, exchange_id="alpaca", market_type="spot",
                symbol="NVDA", side="long", account_qty=manual + 14, strategy_qty=14,
                action="protect_manual")
        assert snapshot.allowed and abs(snapshot.protected_qty - manual) < 1e-9
        assert abs(ownership.protected_quantity(user_id=7, credential_id=credential,
                   market_type="spot", symbol="NVDA", side="long") - manual) < 1e-9
        broker = SimpleNamespace(
            get_positions=lambda **kw: [dict(symbol="NVDA", quantity=manual + 14, side="long")],
            get_orders=lambda **kw: [])
        with guard.alpaca_account_lock(credential):
            qty = guard.guarded_alpaca_quantity(client=broker, strategy_id=1, user_id=7,
                credential_id=credential, symbol="NVDA", signal_type="close_long", amount=9999, order_id=88)
        assert abs(qty - 10) < 1e-9

        def try_lock():
            try:
                with guard.alpaca_account_lock(credential):
                    return "unsafe"
            except ValueError as exc:
                return str(exc)

        with ThreadPoolExecutor(max_workers=1) as pool:
            with guard.alpaca_account_lock(credential):
                assert pool.submit(try_lock).result(timeout=10) == "positionOwnership.accountBusy"
            assert pool.submit(try_lock).result(timeout=10) == "unsafe"
        query("INSERT INTO pending_orders(id,strategy_id,credential_id,symbol,status) VALUES (99,1,%s,'NVDA','sent')", (credential,))
        try:
            guard.ensure_alpaca_settled(user_id=7, credential_id=credential, symbol="NVDA")
            raise AssertionError("pending order was not blocked")
        except ValueError as exc:
            assert str(exc) == "positionOwnership.ordersPending"
        query("UPDATE pending_orders SET status='filled', filled=10 WHERE id=99")
        try:
            guard.ensure_alpaca_settled(user_id=7, credential_id=credential, symbol="NVDA")
            raise AssertionError("unrecorded fill was not blocked")
        except ValueError as exc:
            assert str(exc) == "positionOwnership.ordersPending"
        query("INSERT INTO qd_strategy_trades VALUES (99,10)")
        guard.ensure_alpaca_settled(user_id=7, credential_id=credential, symbol="NVDA")
        print(json.dumps({"passed": ["legacy allocation aliases", "user and credential isolation",
            "protected baseline persistence", "oversized exit cap", "cross-connection lock",
            "lock release", "pending order barrier", "unrecorded fill barrier"], "business_data_modified": False}))
    finally:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        admin.close()


if __name__ == "__main__":
    main()
