from __future__ import annotations

import pytest

from app.services.live_trading.base import LiveOrderResult, LiveTradingError
from app.services.live_trading.contracts import FillSnapshot, OrderIntent
from app.services.live_trading.executors import LimitThenMarketExecutor, MarketOrderExecutor


class RacingExchange:
    exchange_id = "simulated"

    def __init__(self, *, final_qty=2.0, final_status="canceled", cancel_error=False, poll_error=False):
        self.final_qty = final_qty
        self.final_status = final_status
        self.cancel_error = cancel_error
        self.poll_error = poll_error
        self.cancelled = False
        self.market_intents = []

    def place_limit_order(self, intent):
        return LiveOrderResult(self.exchange_id, "limit-1", 0, 0, {})

    def place_market_order(self, intent):
        self.market_intents.append(intent)
        return LiveOrderResult(self.exchange_id, "market-1", 0, 0, {})

    def cancel_order(self, intent, *, order_id=""):
        self.cancelled = True
        if self.cancel_error:
            raise LiveTradingError("cancel acknowledgement lost")
        return {"ok": True}

    def wait_for_fill(self, intent, *, order_id="", max_wait_sec=0):
        if self.poll_error:
            raise LiveTradingError("fill query timed out")
        if order_id == "market-1":
            return FillSnapshot(intent.quantity, 101, "filled", {}, {"USDT": intent.quantity * 0.1})
        qty = self.final_qty if self.cancelled else 1.0
        status = self.final_status if self.cancelled else "partial"
        return FillSnapshot(qty, 100 if qty else 0, status, {}, {"USDT": qty * 0.1})


def intent():
    return OrderIntent("BTC/USDT", "buy", 3, price=100, client_order_id="limit",
                       fallback_client_order_id="market", quote_amount=300)


def test_cancel_race_uses_final_fill_before_market_remainder():
    exchange = RacingExchange(final_qty=2)
    result = LimitThenMarketExecutor(exchange).execute(intent())
    assert exchange.market_intents[0].quantity == 1
    assert exchange.market_intents[0].quote_amount == 100
    assert result.filled_qty == 3
    assert result.avg_price == pytest.approx(100 + 1 / 3)
    assert result.fees_by_ccy == pytest.approx({"USDT": 0.3})


def test_fill_during_cancel_does_not_submit_a_second_order():
    exchange = RacingExchange(final_qty=3, final_status="filled")
    result = LimitThenMarketExecutor(exchange).execute(intent())
    assert exchange.market_intents == []
    assert result.filled_qty == 3
    assert result.exchange_order_id == "limit-1"


@pytest.mark.parametrize("options", [
    {"final_status": "open"},
    {"final_status": "unknown"},
    {"final_qty": 0.5},
    {"cancel_error": True},
])
def test_unconfirmed_cancel_preserves_accepted_order_for_reconciliation(options):
    exchange = RacingExchange(**options)
    result = LimitThenMarketExecutor(exchange).execute(intent())
    assert exchange.market_intents == []
    assert result.success is True
    assert result.exchange_order_id == "limit-1"
    assert result.filled_qty >= 1
    assert result.status == "submitted"


@pytest.mark.parametrize("executor", [MarketOrderExecutor, LimitThenMarketExecutor])
def test_poll_failure_after_acceptance_keeps_order_id_and_does_not_reject(executor):
    exchange = RacingExchange(poll_error=True)
    result = executor(exchange).execute(intent())
    assert result.success is True
    assert result.status == "submitted"
    assert result.exchange_order_id == ("market-1" if executor is MarketOrderExecutor else "limit-1")
    assert len(exchange.market_intents) == (1 if executor is MarketOrderExecutor else 0)


@pytest.mark.parametrize("status", ["CANCELED", "cancelled", "Expired", "REJECTED"])
def test_terminal_cancel_statuses_allow_only_the_confirmed_remainder(status):
    exchange = RacingExchange(final_qty=2, final_status=status)
    result = LimitThenMarketExecutor(exchange).execute(intent())
    assert result.filled_qty == 3
    assert exchange.market_intents[0].quantity == 1


def test_market_tail_rejection_keeps_the_already_filled_limit_leg():
    class RejectedTail(RacingExchange):
        def place_market_order(self, intent):
            raise LiveTradingError("insufficient balance")

    result = LimitThenMarketExecutor(RejectedTail()).execute(intent())
    assert result.success is True
    assert result.filled_qty == 2
    assert result.exchange_order_id == "limit-1"
    assert result.status == "canceled"
    assert result.raw["market_error"] == "insufficient balance"


def test_market_tail_with_exhausted_quote_budget_is_not_submitted():
    from dataclasses import replace

    exchange = RacingExchange(final_qty=2)
    result = LimitThenMarketExecutor(exchange).execute(replace(intent(), quote_amount=100))
    assert exchange.market_intents == []
    assert result.filled_qty == 2


def test_real_adapter_preserves_okx_state_and_remaining_quote_budget(monkeypatch):
    from app.services.live_trading import adapters

    captured = []
    monkeypatch.setattr(adapters, "wait_live_order_fill", lambda **kw: {
        "filled": 2, "avg_price": 100, "state": "canceled",
    })
    monkeypatch.setattr(adapters, "place_live_market_order", lambda **kw: captured.append(kw))
    adapter = adapters.LiveOrderPhaseAdapter(
        client=object(), exchange_id="test", payload={}, exchange_config={},
        spot_quote_amt=300, spot_market_buy_uses_quote=True,
    )
    assert adapter.wait_for_fill(intent()).status == "canceled"
    adapter.place_market_order(OrderIntent("BTC/USDT", "buy", 1, market_type="spot", quote_amount=100))
    assert captured[0]["spot_quote_amt"] == 100


def test_market_tail_poll_timeout_retains_both_legs_for_restart():
    class LostMarketPoll(RacingExchange):
        def wait_for_fill(self, intent, *, order_id="", max_wait_sec=0):
            if order_id == "market-1":
                raise LiveTradingError("market fill query timed out")
            return super().wait_for_fill(intent, order_id=order_id, max_wait_sec=max_wait_sec)

    result = LimitThenMarketExecutor(LostMarketPoll()).execute(intent())
    assert result.success is True
    assert result.exchange_order_id == "market-1"
    assert result.filled_qty == 2
    assert result.status == "submitted"
    assert result.raw["limit_summary"]["filled_qty"] == 2
    assert result.raw["market_summary"]["filled_qty"] == 0
