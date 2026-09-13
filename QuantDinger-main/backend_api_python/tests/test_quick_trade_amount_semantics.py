from app.routes.quick_trade import _resolve_order_notional_usdt


def test_swap_amount_is_margin_and_expands_to_order_notional():
    assert _resolve_order_notional_usdt(100, 5, "swap") == 500


def test_spot_amount_remains_quote_notional():
    assert _resolve_order_notional_usdt(100, 5, "spot") == 100


def test_swap_leverage_is_never_below_one():
    assert _resolve_order_notional_usdt(100, 0, "swap") == 100
