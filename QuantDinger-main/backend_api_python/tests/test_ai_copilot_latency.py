from contextlib import contextmanager
import inspect
from threading import Barrier

from flask import Flask, g
import pytest

from app.routes import ai_chat


@pytest.fixture
def stream_harness(monkeypatch):
    state = {"connections": 0, "events": [], "classifications": 0}

    class Cursor:
        def execute(self, *args):
            pass

        def close(self):
            pass

    class Database:
        def cursor(self):
            return Cursor()

        def commit(self):
            state["events"].append("commit")

    @contextmanager
    def connection():
        state["connections"] += 1
        try:
            yield Database()
        finally:
            state["connections"] -= 1

    def classify(*args):
        assert state["connections"] == 0
        state["classifications"] += 1
        return {"intent": "market_analysis", "should_execute": False}

    def enrich(context, **kwargs):
        assert state["connections"] == 0
        state["events"].append("enrich")
        return context

    def provider(*args, **kwargs):
        assert state["connections"] == 0
        state["events"].append("provider")
        yield "delta", {"text": "answer"}
        assert state["connections"] == 0

    def insert(cur, **kwargs):
        state["events"].append(kwargs["role"])
        return len(state["events"])

    monkeypatch.setattr(ai_chat, "get_db_connection", connection)
    monkeypatch.setattr(ai_chat, "_ensure_tables", lambda cur: None)
    monkeypatch.setattr(ai_chat, "_create_session", lambda *args: 3)
    monkeypatch.setattr(ai_chat, "_insert_message", insert)
    monkeypatch.setattr(ai_chat, "_charge", lambda *args: (True, "", {}))
    monkeypatch.setattr(ai_chat, "_classify_agent_intent", classify)
    monkeypatch.setattr(ai_chat, "_enrich_context", enrich)
    monkeypatch.setattr(ai_chat, "_agent_usage_action", lambda *args: None)
    monkeypatch.setattr(ai_chat, "_record_research_tool_calls", lambda *args: None)
    monkeypatch.setattr(ai_chat, "_load_recent_messages", lambda *args, **kwargs: [{"role": "user", "content": "question"}])
    monkeypatch.setattr(ai_chat, "_prepare_server_context", lambda *args, **kwargs: (kwargs["client_context"], {}))
    monkeypatch.setattr(ai_chat, "_build_llm_messages", lambda *args, **kwargs: ([{"role": "user", "content": "question"}], {}))
    monkeypatch.setattr(ai_chat, "store_insert_request_usage", lambda *args, **kwargs: 1)
    monkeypatch.setattr(ai_chat, "store_update_request_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr(ai_chat, "_stream_llm_with_recovery", provider)
    monkeypatch.setattr(ai_chat, "_detect_memory_candidates", lambda *args: [])
    app = Flask(__name__)

    @contextmanager
    def stream(context=None):
        with app.test_request_context("/api/ai/chat/message/stream", method="POST", json={
            "message": "Analyze SPCX trend and liquidity.", "context": context or {}, "language": "en-US",
        }):
            g.user_id = 7
            response = inspect.unwrap(ai_chat.chat_message_stream)()
            try:
                yield iter(response.response)
            finally:
                response.close()

    return state, stream


def test_stream_accepts_before_slow_work_and_releases_database_during_io(stream_harness):
    state, stream = stream_harness
    with stream() as events:
        assert "event: accepted" in next(events)
        assert state["events"] == ["user", "commit"]
        assert state["connections"] == 0
        assert state["classifications"] == 0
        rest = list(events)
    assert any("event: delta" in event for event in rest)
    assert "event: done" in rest[-1]
    assert state["classifications"] == 1
    assert state["events"].count("user") == 1
    assert state["events"].count("assistant") == 1
    assert state["connections"] == 0


def test_frontend_routing_result_does_not_trigger_another_llm_classification(stream_harness):
    state, stream = stream_harness
    with stream({"market": "USStock", "symbol": "SPCX", "agent_intent": {
        "intent": "market_analysis", "confidence": 95, "should_execute": False,
    }}) as events:
        assert "event: done" in list(events)[-1]
    assert state["classifications"] == 0


def test_billing_rejection_stops_before_research_or_model_work(stream_harness, monkeypatch):
    state, stream = stream_harness
    monkeypatch.setattr(ai_chat, "_charge", lambda *args: (False, "insufficient_credits", {}))
    with stream() as events:
        result = list(events)
    assert "event: accepted" in result[0]
    assert "event: error" in result[1]
    assert "enrich" not in state["events"]
    assert "provider" not in state["events"]
    assert state["classifications"] == 0


def test_research_failure_is_reported_after_acceptance_without_resubmission(stream_harness, monkeypatch):
    state, stream = stream_harness

    def fail(*args, **kwargs):
        raise RuntimeError("data lookup failed")

    monkeypatch.setattr(ai_chat, "_enrich_context", fail)
    with stream() as events:
        result = list(events)
    assert "event: accepted" in result[0]
    assert "event: error" in result[-1]
    assert state["events"].count("user") == 1
    assert "provider" not in state["events"]
    assert state["connections"] == 0


def test_snapshot_fetches_price_and_requested_timeframes_concurrently(monkeypatch):
    rendezvous = Barrier(3, timeout=3)
    calls = []

    class MarketData:
        def get_realtime_price(self, market, symbol, **kwargs):
            calls.append((market, symbol, "price"))
            rendezvous.wait()
            return {"price": 100, "source": "fixture"}

        def get_kline(self, market, symbol, timeframe, limit, **kwargs):
            calls.append((market, symbol, timeframe))
            rendezvous.wait()
            return [{"time": 1700000000 + i * 3600, "open": 100, "high": 102,
                     "low": 99, "close": 101, "volume": 1000} for i in range(20)]

    monkeypatch.setattr(ai_chat, "KlineService", MarketData)
    snapshot = ai_chat._build_market_snapshot({"market": "USStock", "symbol": "SPCX", "snapshot_timeframes": ["1H", "1D"]})
    assert snapshot["price"]["last"] == 100
    assert list(snapshot["timeframes"]) == ["1H", "1D"]
    assert all(frame["available"] for frame in snapshot["timeframes"].values())
    assert sorted(calls) == [("USStock", "SPCX", item) for item in ["1D", "1H", "price"]]


def test_snapshot_partial_failure_preserves_other_evidence(monkeypatch):
    class MarketData:
        def get_realtime_price(self, *args, **kwargs):
            return {"price": 100}

        def get_kline(self, *args, **kwargs):
            raise RuntimeError("history unavailable")

    monkeypatch.setattr(ai_chat, "KlineService", MarketData)
    snapshot = ai_chat._build_market_snapshot({"market": "USStock", "symbol": "SPCX", "snapshot_timeframes": ["1D"]})
    assert snapshot["price"]["last"] == 100
    assert snapshot["timeframes"]["1D"]["available"] is False
    assert snapshot["timeframes"]["1D"]["error"] == "history unavailable"
