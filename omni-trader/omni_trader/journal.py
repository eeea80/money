"""SQLite journal — trades, signals, decisions, equity snapshots, and a
per-strategy memory table. Thread-safe for one FastAPI process via a lock
and WAL mode.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    entry_price REAL NOT NULL,
    entry_time TEXT NOT NULL,
    exit_price REAL,
    exit_time TEXT,
    pnl REAL,
    pnl_pct REAL,
    fees REAL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | closed
    signal_in TEXT,
    signal_out TEXT,
    latency_ms REAL
);
CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    signal TEXT NOT NULL,                  -- long | short | flat
    price REAL NOT NULL,
    reasons TEXT,
    equity_at_signal REAL,
    acted INTEGER NOT NULL DEFAULT 0,
    data_source TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,                    -- fill | halt | throttle | config | info
    detail TEXT
);
CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER,
    ts TEXT NOT NULL,
    equity REAL NOT NULL,
    drawdown_pct REAL NOT NULL,
    daily_pnl REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_memory (
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    total_pnl REAL NOT NULL DEFAULT 0.0,
    last_update TEXT,
    PRIMARY KEY (strategy, symbol, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
"""


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


class Journal:
    """Persistent journal + strategy memory (SQLite, WAL, lock-guarded)."""

    def __init__(self, db_path: str | Path = "data/journal.sqlite3") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.db_path), check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    # -- signals ---------------------------------------------------------
    def record_signal(
        self,
        strategy: str,
        symbol: str,
        timeframe: str,
        signal: str,
        price: float,
        reasons: List[str],
        equity_at_signal: float,
        acted: bool,
        data_source: str = "unknown",
    ) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO signals (ts, strategy, symbol, timeframe, signal,"
                " price, reasons, equity_at_signal, acted, data_source)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    _now(), strategy, symbol, timeframe, signal, price,
                    json.dumps(reasons), equity_at_signal, int(acted),
                    data_source,
                ),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    # -- trades ----------------------------------------------------------
    def record_trade_open(
        self,
        strategy: str,
        symbol: str,
        timeframe: str,
        side: str,
        qty: float,
        entry_price: float,
        entry_time: str,
        signal_in: str,
        latency_ms: float,
    ) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO trades (strategy, symbol, timeframe, side, qty,"
                " entry_price, entry_time, status, signal_in, latency_ms)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (strategy, symbol, timeframe, side, qty, entry_price,
                 entry_time, "open", signal_in, latency_ms),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def record_trade_close(
        self,
        trade_id: int,
        exit_price: float,
        exit_time: str,
        pnl: float,
        pnl_pct: float,
        fees: float,
        signal_out: str,
    ) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE trades SET exit_price=?, exit_time=?, pnl=?, pnl_pct=?,"
                " fees=?, signal_out=?, status='closed' WHERE id=?",
                (exit_price, exit_time, pnl, pnl_pct, fees, signal_out, trade_id),
            )
            self._conn.commit()

    def open_trades(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM trades WHERE status='open' ORDER BY id DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def recent_trades(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM trades ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    def recent_signals(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM signals ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    # -- decisions & outcomes ---------------------------------------------
    def record_decision(self, kind: str, detail: Dict[str, Any] | str) -> int:
        if not isinstance(detail, str):
            detail = json.dumps(detail, default=str)
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO decisions (ts, kind, detail) VALUES (?,?,?)",
                (_now(), kind, detail),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def record_outcome(
        self, trade_id: Optional[int], equity: float,
        drawdown_pct: float, daily_pnl: float,
    ) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO outcomes (trade_id, ts, equity, drawdown_pct,"
                " daily_pnl) VALUES (?,?,?,?,?)",
                (trade_id, _now(), equity, drawdown_pct, daily_pnl),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    # -- strategy memory ---------------------------------------------------
    def update_memory(
        self, strategy: str, symbol: str, timeframe: str,
        pnl: float, is_win: bool,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO strategy_memory
                    (strategy, symbol, timeframe, wins, losses, total_pnl, last_update)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(strategy, symbol, timeframe) DO UPDATE SET
                    wins = wins + ?,
                    losses = losses + ?,
                    total_pnl = total_pnl + ?,
                    last_update = ?
                """,
                (
                    strategy, symbol, timeframe,
                    int(is_win), int(not is_win), pnl, _now(),
                    int(is_win), int(not is_win), pnl, _now(),
                ),
            )
            self._conn.commit()

    def get_memory(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM strategy_memory ORDER BY total_pnl DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    # -- misc ---------------------------------------------------------------
    def counts(self) -> Dict[str, int]:
        with self._lock:
            out = {}
            for table in ("trades", "signals", "decisions", "outcomes",
                          "strategy_memory"):
                out[table] = int(
                    self._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                )
            return out

    def close(self) -> None:
        with self._lock:
            self._conn.close()
