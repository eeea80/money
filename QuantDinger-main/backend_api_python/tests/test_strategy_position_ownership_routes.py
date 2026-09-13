"""Security boundaries for position-ownership API failures."""

import inspect
from contextlib import nullcontext

import pytest
from flask import g

from app.routes import strategy_position_ownership_routes as routes


def test_ownership_read_does_not_expose_internal_exception(app, monkeypatch):
    monkeypatch.setattr(
        routes,
        "_load_ownership_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("private database detail")),
    )
    with app.test_request_context("/api/strategies/position-ownership?id=1"):
        g.user_id = 1
        response, status = inspect.unwrap(routes.get_position_ownership)()

    payload = response.get_json()
    assert status == 500
    assert payload["msg"] == "positionOwnership.loadFailed"
    assert "private database detail" not in str(payload)


def test_ownership_repair_does_not_expose_internal_exception(app, monkeypatch):
    monkeypatch.setattr(routes, "_repair_guard", lambda *args: nullcontext())
    monkeypatch.setattr(
        routes,
        "_load_ownership_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("private exchange detail")),
    )
    with app.test_request_context(
        "/api/strategies/position-ownership/repair",
        method="POST",
        json={"id": 1, "symbol": "BTC/USDT", "side": "long", "action": "recheck"},
    ):
        g.user_id = 1
        response, status = inspect.unwrap(routes.repair_position_ownership_route)()

    payload = response.get_json()
    assert status == 500
    assert payload["msg"] == "positionOwnership.repairFailed"
    assert "private exchange detail" not in str(payload)


def test_ownership_repair_rejects_non_numeric_strategy_id(app):
    with app.test_request_context(
        "/api/strategies/position-ownership/repair",
        method="POST",
        json={"id": "not-an-id", "symbol": "BTC/USDT", "side": "long", "action": "recheck"},
    ):
        g.user_id = 1
        response, status = inspect.unwrap(routes.repair_position_ownership_route)()

    assert status == 400
    assert response.get_json()["msg"] == "positionOwnership.invalidRepairRequest"


@pytest.mark.parametrize(
    ("market_type", "exchange_id", "available"),
    [
        ("spot", "binance", True),
        ("swap", "okx", True),
        ("spot", "alpaca", True),
        ("USStock", "alpaca", True),
    ],
)
def test_ownership_read_reports_supported_coexistence_markets(
    app, monkeypatch, market_type, exchange_id, available
):
    monkeypatch.setattr(
        routes,
        "_load_ownership_rows",
        lambda *_args, **_kwargs: ([], {
            "market_type": market_type,
            "credential_id": 3,
            "exchange": {"exchange_id": exchange_id},
        }),
    )
    with app.test_request_context("/api/strategies/position-ownership?id=1"):
        g.user_id = 1
        response = inspect.unwrap(routes.get_position_ownership)()

    assert response.get_json()["data"]["advanced_coexistence_available"] is available


@pytest.mark.parametrize("symbol,orders,error", [
    ("NVDA", [], ""),
    ("AAPL", [], "positionOwnership.symbolNotOwned"),
    ("NVDA", [{"symbol": "NVDA"}], "positionOwnership.ordersPending"),
])
def test_alpaca_repair_uses_current_owned_snapshot(app, monkeypatch, symbol, orders, error):
    from app.services.live_trading import position_ownership
    from types import SimpleNamespace
    calls = []
    monkeypatch.setattr(routes, "_repair_guard", lambda *args: nullcontext())
    monkeypatch.setattr(routes, "_load_ownership_rows", lambda *args, **kwargs: ([{
        "symbol": "NVDA", "side": "long", "account_qty": 917.768327,
        "strategy_qty": 10, "reference_price": 220,
    }], {"allowed": {"NVDA"}, "credential_id": 33, "market_type": "spot",
         "exchange": {"exchange_id": "alpaca"}, "open_orders": orders}))

    def repair(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(metadata=lambda: {"protected_qty": 907.768327})

    monkeypatch.setattr(position_ownership, "repair_position_ownership", repair)
    with app.test_request_context("/api/strategies/position-ownership/repair", method="POST",
                                  json={"id": 1, "symbol": symbol, "side": "long", "action": "protect_manual"}):
        g.user_id = 7
        result = inspect.unwrap(routes.repair_position_ownership_route)()
    if error:
        response, status = result
        assert status == 409 and response.get_json()["msg"] == error
        assert not calls
    else:
        assert result.get_json()["data"]["protected_qty"] == 907.768327
        assert calls[0]["user_id"] == 7
        assert calls[0]["account_qty"] == 917.768327
        assert calls[0]["strategy_qty"] == 10
        assert calls[0]["market_type"] == "spot"


def test_alpaca_context_uses_spot_bucket_for_stock_asset_class(monkeypatch):
    from types import SimpleNamespace
    from app.services import exchange_execution
    monkeypatch.setattr(routes, "get_strategy_service", lambda: SimpleNamespace(
        get_strategy=lambda *args, **kw: {"symbol": "NVDA", "market_type": "USStock",
                                         "exchange_config": {"credential_id": 33}}))
    monkeypatch.setattr(exchange_execution, "resolve_exchange_config", lambda *a, **kw: {
        "credential_id": 33, "exchange_id": "alpaca"})
    assert routes._ownership_context(1, 7)[3] == "spot"
