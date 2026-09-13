"""Regression coverage for release acceptance failures."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import g

from app.routes.agent_v1 import markets
from app.services.live_trading import account_snapshot as snapshots
from app.services.alpaca_trading.client import AlpacaClient
from app.utils.db_postgres import PostgresCursor


@pytest.mark.parametrize("affected", [0, 1])
def test_insert_count_survives_savepoint_release(affected):
    native = Mock(rowcount=-1)

    def execute(query, *args):
        native.rowcount = affected if query.startswith("INSERT") else -1

    native.execute.side_effect = execute
    native.fetchone.return_value = {"id": 17} if affected else None
    cursor = PostgresCursor(native)
    cursor.execute("INSERT INTO items (name) VALUES (%s) ON CONFLICT DO NOTHING", ("same",))
    assert native.rowcount == -1
    assert cursor.rowcount == affected
    assert cursor.lastrowid == (17 if affected else None)


@pytest.fixture
def broker(monkeypatch):
    client = Mock()
    client.get_positions.return_value = []
    client.get_orders.return_value = []
    monkeypatch.setattr(snapshots, "resolve_exchange_config", lambda *a, **kw: {"exchange_id": "alpaca"})
    monkeypatch.setattr(snapshots, "create_client", lambda *a, **kw: client)
    return client


def test_alpaca_cash_assets_preserve_cost_short_side_and_notional_orders(broker):
    broker.get_positions.return_value = [
        {"symbol": "NVDA", "asset_class": "us_equity", "qty": 3, "avg_entry_price": 110, "current_price": 115},
        {"symbol": "AAPL", "asset_class": "us_equity", "qty": -2, "avgCost": 220, "currentPrice": 215},
        {"symbol": "BTCUSD", "asset_class": "crypto", "qty": 0.01, "avg_entry_price": 70000},
    ]
    broker.get_orders.return_value = [
        {"id": "notional", "symbol": "NVDA", "asset_class": "us_equity", "notional": 100, "qty": None},
        {"id": "partial", "symbol": "AAPL", "asset_class": "us_equity", "qty": 5, "filled_qty": 2},
    ]
    result = snapshots.fetch_account_snapshot(user_id=1, credential_id=1)
    assert result["swap_positions"] == []
    positions = result["spot_positions"]
    assert [(p["symbol"], p["market"], p["side"], p["size"], p["entry_price"]) for p in positions] == [
        ("NVDA", "USStock", "long", 3, 110), ("AAPL", "USStock", "short", 2, 220),
        ("BTC/USD", "Crypto", "long", 0.01, 70000),
    ]
    assert all(p["market_type"] == "spot" for p in positions)
    assert result["open_orders"][0]["notional"] == 100
    assert result["open_orders"][1]["filled"] == 2
    assert result["warnings"] == []
    broker.get_positions.assert_called_once_with(raise_on_error=True)
    broker.get_orders.assert_called_once_with(status="open", limit=500, raise_on_error=True)


def test_alpaca_partial_failure_does_not_look_like_an_empty_account(broker):
    broker.get_positions.side_effect = RuntimeError("provider unavailable")
    broker.get_orders.return_value = [{"id": "open", "symbol": "NVDA", "qty": 1}]
    result = snapshots.fetch_account_snapshot(user_id=1, credential_id=1)
    assert result["partial"] is True
    assert result["warnings"] == ["brokerAccounts.snapshotPositionsFailed"]
    broker.get_orders.side_effect = RuntimeError("provider unavailable")
    result = snapshots.fetch_account_snapshot(user_id=1, credential_id=1)
    assert result["error"] == "brokerAccounts.snapshotPositionsFailed"
    assert len(result["warnings"]) == 2


def test_alpaca_empty_success_and_connection_failure_are_distinct(broker, monkeypatch):
    result = snapshots.fetch_account_snapshot(user_id=1, credential_id=1)
    assert not result.get("error") and result["warnings"] == []
    monkeypatch.setattr(snapshots, "create_client", Mock(side_effect=RuntimeError("connection failed")))
    result = snapshots.fetch_account_snapshot(user_id=1, credential_id=1)
    assert result["error"] == "brokerAccounts.snapshotConnectionFailed"


@pytest.mark.parametrize("method", ["get_positions", "get_orders"])
def test_alpaca_strict_reads_propagate_failure_and_keep_legacy_default(method):
    client = AlpacaClient.__new__(AlpacaClient)
    client._ensure_connected = Mock(side_effect=RuntimeError("provider failure"))
    assert getattr(client, method)() == []
    with pytest.raises(RuntimeError, match="provider failure"):
        getattr(client, method)(raise_on_error=True)


@pytest.mark.parametrize("source,kind", [("ticker", "latest_available"), ("kline_1d", "historical")])
def test_agent_quote_uses_ticker_service_and_labels_daily_fallback(app, monkeypatch, source, kind):
    service = SimpleNamespace(get_realtime_price=Mock(return_value={"price": 72.5, "source": source, "timestamp": 1234}))
    monkeypatch.setattr(markets, "_kline_service", service)
    with app.test_request_context("/price?market=Futures&symbol=CL"):
        g.agent_token = {"markets": "*", "instruments": "*"}
        response, status = markets.price.__wrapped__()
        assert status == 200
        result = response.get_json()["data"]
    assert result["price"] == 72.5 and result["quote_type"] == kind
    assert result["timestamp"] == 1234
    service.get_realtime_price.assert_called_once_with(market="Futures", symbol="CL")


@pytest.mark.parametrize("value", [None, 0, -1, float("nan"), float("inf")])
def test_agent_quote_unavailable_is_retriable_error(app, monkeypatch, value):
    monkeypatch.setattr(markets._kline_service, "get_realtime_price", lambda **kw: {"price": value})
    with app.test_request_context("/price?market=Futures&symbol=CL"):
        g.agent_token = {"markets": "*", "instruments": "*"}
        response, status = markets.price.__wrapped__()
    assert status == 503
    assert response.get_json()["retriable"] is True


def test_agent_quote_keeps_instrument_restrictions(app, monkeypatch):
    fetch = Mock()
    monkeypatch.setattr(markets._kline_service, "get_realtime_price", fetch)
    with app.test_request_context("/price?market=Futures&symbol=CL"):
        g.agent_token = {"markets": "*", "instruments": "GC"}
        _, status = markets.price.__wrapped__()
    assert status == 403
    fetch.assert_not_called()
