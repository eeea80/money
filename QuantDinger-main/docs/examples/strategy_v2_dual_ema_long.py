"""Dual EMA trend example for Strategy API V2."""

# @param fast_period int 20 range=2:100:1
# @param slow_period int 50 range=3:250:1
# @param target_pct float 0.95 range=0.05:1:0.05


def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_warmup(260)


def handle_data(context, data):
    fast_period = int(context.params.get("fast_period", 20))
    slow_period = int(context.params.get("slow_period", 50))
    target_pct = float(context.params.get("target_pct", 0.95))
    bars = get_history(slow_period + 2, "1d", "close", g.symbol)
    if len(bars) < slow_period + 1:
        return
    close = bars["close"]
    fast = float(close.tail(fast_period).mean())
    slow = float(close.tail(slow_period).mean())
    target = target_pct if fast > slow else 0.0
    order_target_percent(
        g.symbol,
        target,
        reason="dual_ema_regime",
        stop_loss_pct=0.05 if target > 0 else 0.0,
    )
