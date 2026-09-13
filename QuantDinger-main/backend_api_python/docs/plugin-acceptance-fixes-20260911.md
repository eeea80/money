# Plugin acceptance fixes — 2026-09-11

These changes address the online complex-strategy tests with backtest run IDs 3138–3141. They modify the backend and frontend error translations; the plugin transport does not require a reinstall.

## Quantity handling

- Integral lot counts are recovered within four floating-point ULPs before flooring. Repeated spot entries and full exits no longer lose an additional lot through binary arithmetic.
- Same-direction target rebalances on USD/USDT/USDC-quoted crypto ignore differences up to 10 quote units. This applies in both the backtest broker and live intent planner. New entries, reversals, stock orders, and full-close intents do not use this rebalance suppression.
- Simulated full exits reconcile sub-lot residues worth at most 10 quote units, subject to liquidity limits. Cash, fees, and closed-trade accounting include the reconciled quantity. Such executions expose `sub_lot_reconciled`; results also describe the policy in `executionAssumptions`. This is an explicit simulation approximation, not a claim that a real venue accepts sub-lot orders.
- Existing historical results are unchanged. Rerun strategies to generate results under the new policy.

## Historical data

- Bounded US intraday history no longer falls back to Nasdaq's latest-session chart and thereby suppresses the historical yfinance fallback.
- Explicit history start times are respected instead of expanding the request according to a latest-bars estimate.
- Stock intraday warmup requests allow for session hours, weekends, and holiday margins.
- Before replay or persistence, each frequency/symbol bundle must contain the declared number of pre-start warmup bars. Insufficient data raises `strategyV2.insufficientWarmupData`; English and Chinese UI translations explain how to change the timeframe/start date.
- These checks cannot create data a provider does not supply; unavailable history must not be presented as a successful zero-trade backtest.

## Alpaca

- The generic exchange validator now supports Alpaca demo environments.
- The canonical environment controls the adapter's paper flag. Legacy paper-key inference remains supported when explicit environment flags are absent.
- Paper clients use the Alpaca paper API endpoint even if a conflicting live base URL is supplied.

## Verification and release

Regression coverage includes 50 consecutive spot round trips with no dust, exact cash/fee reconciliation, the 10-unit boundary, liquidity caps, small new entries, full-close preservation in live intent planning, the real backtest service's insufficient-data rejection, historical-provider fallback, and Alpaca paper/live routing. Exchange calls in unit tests are mocked; no orders are sent.

Deploy the backend and rebuild the frontend for the translated error. Restart backend workers so the changed Python modules are loaded. Then rerun the saved strategies and recheck the Alpaca account snapshot through the plugin. Account connectivity and newly generated online results still require post-deployment verification; no deployment was performed in this repair session.
