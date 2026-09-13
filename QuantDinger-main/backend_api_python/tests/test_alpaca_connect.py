from uuid import UUID
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.alpaca_trading.client import AlpacaClient, AlpacaConfig, _as_str_id, _id_log_prefix


def test_as_str_id_from_uuid():
    uid = UUID("12345678-1234-5678-1234-567812345678")
    assert _as_str_id(uid) == "12345678-1234-5678-1234-567812345678"
    assert _id_log_prefix(uid) == "12345678-123"


@patch("app.services.alpaca_trading.client._ensure_alpaca")
def test_alpaca_connect_stores_string_account_id(mock_ensure):
    mock_modules = {
        "TradingClient": MagicMock(),
        "StockHistoricalDataClient": MagicMock(),
        "CryptoHistoricalDataClient": MagicMock(),
    }
    mock_ensure.return_value = mock_modules

    account = MagicMock()
    account.id = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    account.status = "ACTIVE"

    trading = MagicMock()
    trading.get_account.return_value = account
    mock_modules["TradingClient"].return_value = trading

    client = AlpacaClient(
        AlpacaConfig(api_key="PKtest", secret_key="secret", paper=True)
    )
    assert client.connect() is True
    assert client._account_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert isinstance(client._account_id, str)
    mock_modules["StockHistoricalDataClient"].assert_called_once_with(
        api_key="PKtest", secret_key="secret", sandbox=False
    )
    mock_modules["CryptoHistoricalDataClient"].assert_called_once_with(
        api_key="PKtest", secret_key="secret", sandbox=False
    )


@patch("app.services.alpaca_trading.client.time.sleep", return_value=None)
@patch("app.services.alpaca_trading.client._ensure_alpaca")
def test_crypto_market_sell_caps_quantity_to_available_position(mock_ensure, _mock_sleep):
    market_request = MagicMock()
    modules = {
        "MarketOrderRequest": market_request,
        "OrderSide": SimpleNamespace(BUY="buy", SELL="sell"),
        "TimeInForce": SimpleNamespace(GTC="gtc", DAY="day"),
    }
    mock_ensure.return_value = modules
    trading = MagicMock()
    trading.get_all_positions.return_value = [SimpleNamespace(symbol="BTCUSD", qty="0.000349125")]
    order = SimpleNamespace(
        id="order-1",
        filled_qty="0.000349125",
        filled_avg_price="100000",
        status=SimpleNamespace(value="filled"),
        submitted_at="now",
    )
    trading.submit_order.return_value = order
    trading.get_order_by_id.return_value = order

    client = AlpacaClient(AlpacaConfig(api_key="PKtest", secret_key="secret", paper=True))
    client._trading_client = trading
    client._account_id = "account-1"

    result = client.place_market_order("BTC/USD", "sell", 0.00035, "crypto")

    assert result.success is True
    market_request.assert_called_once_with(
        symbol="BTC/USD", qty=0.000349125, side="sell", time_in_force="gtc"
    )
    assert result.raw["requested_qty"] == 0.00035
    assert result.raw["submitted_qty"] == 0.000349125


@patch("app.services.alpaca_trading.client.time.sleep", return_value=None)
@patch("app.services.alpaca_trading.client._ensure_alpaca")
def test_equity_market_sell_caps_quantity_to_available_fractional_position(mock_ensure, _mock_sleep):
    market_request = MagicMock()
    modules = {
        "MarketOrderRequest": market_request,
        "OrderSide": SimpleNamespace(BUY="buy", SELL="sell"),
        "TimeInForce": SimpleNamespace(GTC="gtc", DAY="day"),
    }
    mock_ensure.return_value = modules
    trading = MagicMock()
    trading.get_all_positions.return_value = [SimpleNamespace(symbol="SPY", qty="12.654518329")]
    order = SimpleNamespace(
        id="order-2",
        filled_qty="12.654518329",
        filled_avg_price="743.46",
        status=SimpleNamespace(value="filled"),
        submitted_at="now",
    )
    trading.submit_order.return_value = order
    trading.get_order_by_id.return_value = order

    client = AlpacaClient(AlpacaConfig(api_key="PKtest", secret_key="secret", paper=True))
    client._trading_client = trading
    client._account_id = "account-1"

    result = client.place_market_order("SPY", "sell", 12.65451833, "USStock")

    assert result.success is True
    market_request.assert_called_once_with(
        symbol="SPY", qty=12.654518329, side="sell", time_in_force="day"
    )
    assert result.raw["submitted_qty"] == 12.654518329


@patch("app.services.alpaca_trading.client._ensure_alpaca")
def test_recent_orders_include_filled_orders_by_default(mock_ensure):
    request_factory = MagicMock()
    mock_ensure.return_value = {
        "GetOrdersRequest": request_factory,
        "QueryOrderStatus": SimpleNamespace(ALL="all", OPEN="open"),
    }
    trading = MagicMock()
    trading.get_orders.return_value = [
        SimpleNamespace(
            id="filled-order",
            symbol="AAPL",
            side=SimpleNamespace(value="buy"),
            qty="2",
            notional=None,
            order_type=SimpleNamespace(value="market"),
            limit_price=None,
            status=SimpleNamespace(value="filled"),
            filled_qty="2",
            filled_avg_price="210.5",
            submitted_at="2026-07-17T01:00:00Z",
            extended_hours=False,
        )
    ]
    client = AlpacaClient(AlpacaConfig(api_key="PKtest", secret_key="secret", paper=True))
    client._trading_client = trading
    client._account_id = "account-1"

    orders = client.get_orders()

    request_factory.assert_called_once_with(status="all", limit=100)
    assert orders[0]["status"] == "filled"
    assert orders[0]["filled"] == 2.0
    assert orders[0]["remaining"] == 0.0
