"""
S&P 500 Profitable Top 50 MA20/MA60
Daily long-only strategy. Require point-in-time index membership and complete
market-cap and latest reported net-income coverage. Net income is NOT TTM.
Rank profitable members by market cap; buy fresh bullish SMA20/SMA60 crosses
and exit bearish crosses. Limit entry cost including configured fees to USD1000
per stock, with at most ten held or reserved stock slots. Use whole shares and
signal-close limit entries; cancel unfilled entries after one daily fill window.
Existing holdings exit on bearish crosses, not merely changes in rank.
"""

PERSIST_RUNTIME_STATE = True
MAX_STOCKS = 10
STOCK_BUDGET = 1000.0


def initialize(context):
    context.set_universe(pool="sp500")
    context.subscribe(frequency="1d", fields=["open", "high", "low", "close", "volume"])
    context.set_benchmark("USStock:SPY")
    context.set_warmup(61)
    context.set_metadata(direction_mode="long_only", strategy_family="profitable_large_cap_crossover")
    g.pending = {}
    g.exit_due = {}


def crosses(symbol):
    fast = indicator("sma", symbol, period=20).dropna()
    slow = indicator("sma", symbol, period=60).dropna()
    if len(fast) < 2 or len(slow) < 2:
        return False, False
    bullish = fast.iloc[-2] <= slow.iloc[-2] and fast.iloc[-1] > slow.iloc[-1]
    bearish = fast.iloc[-2] >= slow.iloc[-2] and fast.iloc[-1] < slow.iloc[-1]
    return bool(bullish), bool(bearish)


def handle_data(context, data):
    stamp = str(context.current_dt)
    terminal = ["filled", "rejected", "failed", "cancelled", "canceled", "expired"]
    for symbol in list(g.pending.keys()):
        pending = g.pending[symbol]
        status = get_order_status(pending["ref"])
        if status["status"] in terminal:
            del g.pending[symbol]
        elif pending["side"] == "buy" and pending["stamp"] != stamp:
            cancel_order(pending["ref"])

    positions = {symbol: pos for symbol, pos in get_positions().items() if pos.amount > 0}
    for symbol in positions:
        _, bearish = crosses(symbol)
        if bearish:
            g.exit_due[symbol] = True
        if g.exit_due.get(symbol) and symbol not in g.pending:
            ref = order_target(symbol, 0, reason="ma20_below_ma60", client_order_id="sell-" + symbol + "-" + stamp)
            if ref:
                g.pending[symbol] = {"ref": ref, "side": "sell", "stamp": stamp}
    for symbol in list(g.exit_due.keys()):
        if symbol not in positions and symbol not in g.pending:
            del g.exit_due[symbol]

    members = list(get_universe_stocks())
    if len(members) < 500:
        raise ValueError("sp500_historical_membership_unavailable")
    fundamentals = get_fundamentals(["market_cap", "net_income"], members)
    complete = fundamentals.dropna(subset=["market_cap", "net_income"])
    if len(complete) != len(members) or bool((complete["market_cap"] <= 0).any()):
        raise ValueError("sp500_market_cap_or_reported_net_income_coverage_incomplete")
    eligible = complete[complete["net_income"] > 0]
    ranked = eligible.sort_values("market_cap", ascending=False, kind="mergesort")
    selected = list(ranked.head(50).index)
    reserved = list(positions.keys())
    for symbol, pending in g.pending.items():
        if pending["side"] == "buy" and symbol not in reserved:
            reserved.append(symbol)
    cash = max(0.0, float(context.portfolio.available_cash))
    cash -= sum(STOCK_BUDGET for pending in g.pending.values() if pending["side"] == "buy")
    fee_rate = max(0.0, float(context.params.get("commission", 0.001)))
    for symbol in selected:
        if len(reserved) >= MAX_STOCKS or cash <= 0:
            break
        if symbol in reserved or symbol in g.pending:
            continue
        bullish, _ = crosses(symbol)
        if not bullish:
            continue
        price = float(data.current(symbol, field="close"))
        if price <= 0:
            continue
        budget = min(STOCK_BUDGET, cash)
        quantity = int(budget / (price * (1.0 + fee_rate)))
        if quantity <= 0:
            continue
        ref = order(symbol, quantity, order_type="limit", limit_price=price,
                    reason="profitable_top50_ma20_above_ma60",
                    client_order_id="buy-" + symbol + "-" + stamp)
        if ref:
            g.pending[symbol] = {"ref": ref, "side": "buy", "stamp": stamp}
            reserved.append(symbol)
            cash -= quantity * price * (1.0 + fee_rate)
