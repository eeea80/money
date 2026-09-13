"""Regression coverage for quote turnover being mistaken for a BTC unit price."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.grid.exchange_orders import _parse_grid_order_fill, query_grid_order_fill
from app.services.grid.fill_units import parse_grid_order_fill
from app.services.grid.poller import GridFillPoller
from app.services.grid.resting_orders_repo import GridRestingOrder
from app.services.live_trading.gate import GateSpotClient
from app.services.live_trading.gate_spot_fill import parse_gate_spot_fill


def spot_order(**overrides):
    return dict({
        "id": "123", "currency_pair": "BTC_USDT", "type": "limit", "side": "buy",
        "status": "closed", "amount": "0.00016", "left": "0",
        "filled_amount": "0.00016", "filled_total": "12.4902",
        "fill_price": "12.4902", "avg_deal_price": "78063.75", "price": "79000",
        "fee": "0.00000016", "fee_currency": "BTC",
    }, **overrides)


@pytest.mark.parametrize("average", ["78063.75", "0", "", None])
@pytest.mark.parametrize("total", ["12.4902", "0", None])
def test_spot_average_never_uses_quote_turnover_as_unit_price(average, total):
    base, price = parse_gate_spot_fill(spot_order(avg_deal_price=average, filled_total=total))
    assert base == pytest.approx(0.00016)
    assert price == pytest.approx(78063.75)
    assert base * price == pytest.approx(12.4902)


@pytest.mark.parametrize("client", [None, GateSpotClient(api_key="k", secret_key="s")])
def test_generic_and_exchange_aware_grid_parsers_keep_base_units(client):
    base, price, status = parse_grid_order_fill(
        client, symbol="BTC/USDT", market_type="spot", exchange_config={}, data=spot_order(),
    )
    assert (base, price) == pytest.approx((0.00016, 78063.75))
    assert status == "filled"
    assert _parse_grid_order_fill(spot_order()) == (base, price, status)


def test_market_buy_quote_amount_is_not_interpreted_as_base_quantity():
    data = spot_order(type="market", amount="12.4902", avg_deal_price=None)
    data.pop("filled_amount")
    assert parse_gate_spot_fill(data) == (0.0, 0.0)
    data["avg_deal_price"] = "78063.75"
    assert parse_gate_spot_fill(data) == pytest.approx((0.00016, 78063.75))


def test_missing_execution_price_does_not_use_limit_price():
    assert parse_gate_spot_fill(spot_order(
        filled_total=None, fill_price=None, avg_deal_price=None,
    )) == (0.00016, 0.0)


def test_zero_fill_does_not_infer_an_execution_from_requested_amount():
    assert parse_gate_spot_fill(spot_order(filled_amount="0")) == (0.0, 0.0)


def test_rest_wait_and_grid_query_agree_on_gate_spot_fill():
    client = GateSpotClient(api_key="k", secret_key="s")
    with patch.object(client, "get_order", return_value=spot_order()):
        base, price, _ = query_grid_order_fill(
            client, symbol="BTC/USDT", market_type="spot", exchange_order_id="123",
        )
        fill = client.wait_for_fill(order_id="123", symbol="BTC/USDT", max_wait_sec=0)
    assert (base, price) == pytest.approx((0.00016, 78063.75))
    assert (fill["filled"], fill["avg_price"]) == (base, price)


def test_poller_posts_actual_unit_price_and_converts_base_fee_correctly():
    client = GateSpotClient(api_key="k", secret_key="s")
    runner = MagicMock()
    runner.exchange_config = {}
    poller = GridFillPoller()
    order = GridRestingOrder(
        id=1, strategy_id=168, symbol="BTC/USDT", exchange_order_id="123",
        quantity=0.00016, price=79000, status="open",
    )
    with (
        patch.object(client, "get_order", return_value=spot_order()),
        patch.object(poller._repo, "update_status") as update,
    ):
        poller._poll_order(runner, client, order, "spot")
    posted = runner.engine.on_order_filled.call_args
    assert posted.args[1:] == pytest.approx((0.00016, 78063.75))
    assert posted.kwargs["commission_quote"] == pytest.approx(0.0124902)
    assert update.call_args.kwargs["avg_fill_price"] == pytest.approx(78063.75)
