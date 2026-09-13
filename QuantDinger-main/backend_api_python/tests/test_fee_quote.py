from app.services.live_trading.fee_quote import fee_to_quote, symbol_currencies


def test_symbol_currencies_handles_perpetual_suffix():
    assert symbol_currencies("BTC/USDT:USDT") == ("BTC", "USDT")


def test_fee_paid_in_base_is_converted_at_fill_price():
    assert fee_to_quote(
        object(), symbol="BTC/USDT", fee=0.001, fee_ccy="BTC", fill_price=60_000
    ) == 60


def test_stable_fee_is_equivalent_to_stable_quote():
    assert fee_to_quote(
        object(), symbol="BTC/USDT", fee=1.25, fee_ccy="USDC", fill_price=60_000
    ) == 1.25


def test_stock_usd_commission_is_already_quote_currency():
    assert fee_to_quote(
        object(), symbol="AAPL", fee=0.35, fee_ccy="USD", fill_price=200
    ) == 0.35


def test_third_asset_fee_uses_direct_quote_ticker():
    class Client:
        def get_ticker(self, symbol):
            assert symbol == "BNB/USDT"
            return {"last": 700}

    assert fee_to_quote(
        Client(), symbol="BTC/USDT", fee=0.01, fee_ccy="BNB", fill_price=60_000
    ) == 7


def test_unknown_fee_asset_does_not_fake_a_quote_value():
    assert fee_to_quote(
        object(), symbol="BTC/USDT", fee=1, fee_ccy="XYZ", fill_price=60_000
    ) is None
