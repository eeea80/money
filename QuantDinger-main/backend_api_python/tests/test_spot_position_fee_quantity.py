import pytest

from app.services.pending_orders.fill_records import (
    proportional_spot_position_fill_quantity,
    spot_position_fill_quantity,
)


def test_spot_buy_base_fee_reduces_strategy_owned_quantity():
    assert spot_position_fill_quantity(
        market_type="spot",
        symbol="SOL/USDT",
        signal_type="open_long",
        gross_quantity=10.0,
        fees_by_ccy={"SOL": 0.01},
    ) == pytest.approx(9.99)


def test_spot_sell_base_fee_reduces_inventory_in_addition_to_fill():
    assert spot_position_fill_quantity(
        market_type="spot",
        symbol="SOL/USDT",
        signal_type="close_long",
        gross_quantity=9.98,
        fees_by_ccy={"SOL": 0.01},
    ) == pytest.approx(9.99)


def test_quote_fee_does_not_change_spot_base_inventory():
    assert spot_position_fill_quantity(
        market_type="spot",
        symbol="SOL/USDT",
        signal_type="open_long",
        gross_quantity=10.0,
        fees_by_ccy={"USDT": 0.2},
    ) == pytest.approx(10.0)


def test_partial_record_uses_proportional_share_of_cumulative_base_fee():
    assert proportional_spot_position_fill_quantity(
        market_type="spot",
        symbol="SOL/USDT",
        signal_type="open_long",
        recorded_quantity=4.0,
        cumulative_quantity=10.0,
        cumulative_fees_by_ccy={"SOL": 0.01},
    ) == pytest.approx(3.996)
