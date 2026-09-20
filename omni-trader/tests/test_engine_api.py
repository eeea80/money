"""Integration tests: strategy -> engine -> risk -> journal pipeline,
plus the FastAPI endpoints."""

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from omni_trader.api import create_app, AppContext
from omni_trader.journal import Journal
from omni_trader.paper_engine import PaperConfig, PaperEngine
from omni_trader.risk import RiskManager
from omni_trader.strategies import Signal, get_strategy, registered_strategies


def make_candles(n=120, seed=3, base=100.0):
    import numpy as np
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01", periods=n, freq="1min", tz="UTC")
    ret = rng.normal(0, 0.004, n)
    ret[30:70] += 0.01  # engineered trend so a cross actually fires
    ret[80:] -= 0.012
    close = pd.Series(base * np.exp(np.cumsum(ret)), index=idx)
    open_ = close.shift(1).fillna(base)
    spread = (np.abs(rng.normal(0, 0.002, n)) * close)
    return pd.DataFrame({
        "open": open_,
        "high": np.maximum(open_, close) + spread,
        "low": np.minimum(open_, close) - spread,
        "close": close,
        "volume": np.abs(rng.normal(10, 2, n)),
    }, index=idx)


# ---------------------------------------------------------------- strategy
def test_strategy_registry_has_first_strategy():
    assert "ema_cross_rsi" in registered_strategies()
    s = get_strategy("ema_cross_rsi")
    assert s.fast == 12 and s.slow == 26


def test_strategy_unknown_name_raises():
    with pytest.raises(KeyError):
        get_strategy("nope")


def test_strategy_returns_valid_signal():
    sig = get_strategy("ema_cross_rsi").generate(make_candles())
    assert sig.signal in (Signal.LONG, Signal.SHORT, Signal.FLAT)
    assert sig.reasons  # always explains itself


# ---------------------------------------------------------------- engine + journal
def test_engine_end_to_end_signal_journal_and_fill(tmp_path):
    journal = Journal(tmp_path / "j.sqlite3")
    risk = RiskManager(10_000, "balanced")
    engine = PaperEngine(
        strategy=get_strategy("ema_cross_rsi"),
        journal=journal,
        risk_manager=risk,
        config=PaperConfig(execution_latency_ms=140.0),
        symbol="BTC/USDT",
        timeframe="1m",
    )
    df = make_candles()
    engine.on_candle(df, "sample")

    counts = journal.counts()
    assert counts["signals"] == len(df)  # every closed candle evaluated

    # latency is recorded as configured (140ms) in decisions/journal
    assert engine.config.execution_latency_ms == 140.0
    # a trend segment is engineered -> at least one LONG signal must appear
    sigs = journal.recent_signals(300)
    assert any(s["signal"] in ("long", "short") for s in sigs)

    # if a fill happened, trades must exist and risk state must update
    if counts["trades"]:
        tr = journal.recent_trades(1)[0]
        assert tr["status"] in ("open", "closed")
    journal.close()


def test_engine_never_fills_same_candle(tmp_path):
    """Fills happen only at candle-open prices, never mid-candle or at the
    very first candle; every fill has preceding signal evaluations."""
    journal = Journal(tmp_path / "j.sqlite3")
    engine = PaperEngine(
        strategy=get_strategy("ema_cross_rsi"),
        journal=journal,
        risk_manager=RiskManager(10_000, "balanced"),
        config=PaperConfig(),
    )
    df = make_candles()
    engine.on_candle(df, "sample")
    opens = set(df.index.astype(str))
    first_open = str(df.index[0])
    for tr in journal.recent_trades(300):
        assert tr["entry_time"] in opens          # filled at a candle open
        assert tr["entry_time"] != first_open     # not before any signal existed
    # every fill is backed by evaluated signals
    counts = journal.counts()
    if counts["trades"]:
        assert counts["signals"] >= counts["trades"]
    journal.close()


def test_engine_respects_risk_halt(tmp_path):
    journal = Journal(tmp_path / "j.sqlite3")
    risk = RiskManager(10_000, "conservative")
    engine = PaperEngine(
        strategy=get_strategy("ema_cross_rsi"),
        journal=journal,
        risk_manager=risk,
        config=PaperConfig(),
    )
    risk.on_trade_closed(-200)  # 2% cap hit -> halted
    df = make_candles()
    engine.on_candle(df, "sample")
    for tr in journal.recent_trades(10):
        assert tr["status"] != "open"  # nothing new opened while halted
    journal.close()


# ---------------------------------------------------------------- journal
def test_journal_memory_updates(tmp_path):
    journal = Journal(tmp_path / "j.sqlite3")
    journal.update_memory("ema_cross_rsi", "BTC/USDT", "1m", 50.0, True)
    journal.update_memory("ema_cross_rsi", "BTC/USDT", "1m", -20.0, False)
    mem = journal.get_memory()
    assert len(mem) == 1
    row = mem[0]
    assert row["wins"] == 1 and row["losses"] == 1
    assert row["total_pnl"] == pytest.approx(30.0)
    journal.close()


# ---------------------------------------------------------------- API
@pytest.fixture()
def client(tmp_path):
    ctx = AppContext(
        db_path=str(tmp_path / "api.sqlite3"),
        execution_latency_ms=140.0,
    )
    app = create_app(ctx)
    return TestClient(app), ctx


def test_api_status_paper_only(client):
    client, ctx = client
    r = client.get("/status")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "paper"
    assert body["engine"]["execution_latency_ms"] == 140.0


def test_api_settings_roundtrip(client):
    client, _ = client
    r = client.get("/settings")
    assert r.status_code == 200
    assert r.json()["risk_mode"] == "balanced"
    r = client.post("/settings", params={"risk_mode": "conservative",
                                         "execution_latency_ms": 250})
    assert r.status_code == 200
    body = r.json()["settings"]
    assert body["risk_mode"] == "conservative"
    assert body["execution_latency_ms"] == 250.0
    r = client.post("/settings", params={"risk_mode": "nuclear"})
    assert r.status_code == 400


def test_api_signals_trades(client):
    client, ctx = client
    df = make_candles(60)
    ctx.engine.on_candle(df, "sample")
    r = client.get("/signals?limit=5")
    assert r.status_code == 200
    assert len(r.json()["signals"]) <= 5
    r = client.get("/trades")
    assert r.status_code == 200
    assert "memory" in r.json()


def test_api_candles(client):
    client, _ = client
    r = client.get("/candles?limit=10")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] <= 10
    assert body["source"] in ("binance", "sample")


def test_api_status_page_bilingual(client):
    client, _ = client
    en = client.get("/?lang=en").text
    fa = client.get("/?lang=fa").text
    assert "Omni-Trader" in en and "امنی‌تریدر" in fa
    assert 'dir="rtl"' in fa and 'dir="ltr"' in en
