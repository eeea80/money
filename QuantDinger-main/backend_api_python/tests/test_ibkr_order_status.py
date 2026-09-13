from types import SimpleNamespace

from app.services.ibkr_trading.client import IBKRClient


def test_ibkr_get_order_status_queries_completed_orders_after_restart():
    order = SimpleNamespace(orderId=123, permId=987)
    status = SimpleNamespace(status="Filled", filled=4, remaining=0, avgFillPrice=205.25)
    trade = SimpleNamespace(order=order, orderStatus=status)
    ib = SimpleNamespace(
        openTrades=lambda: [],
        trades=lambda: [],
        reqCompletedOrders=lambda api_only: [trade],
    )
    client = object.__new__(IBKRClient)
    client._ib = ib
    client._ensure_connected = lambda: None

    result = client.get_order_status(123)

    assert result.success is True
    assert result.status == "Filled"
    assert result.filled == 4
    assert result.avg_price == 205.25
    assert result.raw["permId"] == 987


def test_ibkr_get_order_status_uses_account_wide_open_orders_and_commission():
    order = SimpleNamespace(orderId=12, permId=9988)
    status = SimpleNamespace(status="Filled", filled=2, remaining=0, avgFillPrice=100)
    fill = SimpleNamespace(
        commissionReport=SimpleNamespace(commission=0.35, currency="USD")
    )
    trade = SimpleNamespace(order=order, orderStatus=status, fills=[fill])
    calls = []
    ib = SimpleNamespace(
        reqAllOpenOrders=lambda: calls.append("all") or [trade],
        openTrades=lambda: [],
        trades=lambda: [],
        reqCompletedOrders=lambda api_only: [],
    )
    client = object.__new__(IBKRClient)
    client._ib = ib
    client._ensure_connected = lambda: None

    result = client.get_order_status(9988)

    assert calls == ["all"]
    assert result.order_id == 9988
    assert result.raw["commission"] == 0.35
    assert result.raw["commission_ccy"] == "USD"


def test_ibkr_completed_order_recovers_commission_from_executions():
    order = SimpleNamespace(orderId=12, permId=9988)
    status = SimpleNamespace(status="Filled", filled=2, remaining=0, avgFillPrice=100)
    trade = SimpleNamespace(order=order, orderStatus=status, fills=[])
    execution_fill = SimpleNamespace(
        execution=SimpleNamespace(orderId=77, permId=9988),
        commissionReport=SimpleNamespace(commission=0.42, currency="USD"),
    )
    ib = SimpleNamespace(
        reqAllOpenOrders=lambda: [],
        openTrades=lambda: [],
        trades=lambda: [],
        reqCompletedOrders=lambda api_only: [trade],
        reqExecutions=lambda: [execution_fill],
    )
    client = object.__new__(IBKRClient)
    client._ib = ib
    client._ensure_connected = lambda: None

    result = client.get_order_status(9988)

    assert result.raw["commission"] == 0.42
    assert result.raw["commission_ccy"] == "USD"
