# Portfolio execution validation — 2026-09-12

## Scope and result

Reviewed and repaired the data preparation and live portfolio execution paths needed by the S&P 500 profitable top-50 moving-average strategy. Local regression and isolated Docker database/broker-fixture checks passed. This is not certification of all production behavior or a real brokerage execution test.

The reference strategy is [sp500_profitable_top50.py](sp500_profitable_top50.py). It uses daily MA20/MA60 crosses, latest reported positive net income, market-cap ranking, whole-share limit entries with a configured fee allowance, USD 1,000 per entry, and at most ten held or reserved symbols. Positive income currently means the latest reported period; switching to the new `net_income_ttm` field requires four-quarter data coverage. Price appreciation can increase a position's market value above its entry budget.

## Repairs

- Reject backtests predating a snapshot-only universe before downloading market data. Report the missing history boundary, affected warmup symbol/frequency/count, and missing fundamental fields. Return consistent universe member counts and `history_from` metadata.
- Prefer daily close times the latest available share count for market-cap ranking. Normalize timezone-aware panels. Add four-consecutive-quarter `net_income_ttm`. Newly synchronized financials require a reported earnings date and become usable on the following calendar day.
- Cache successful fundamental schema initialization instead of executing DDL for every member load.
- Refresh dynamic live universe membership and retain existing positions and pending symbols after removal from the universe or process restart.
- Fetch strategy positions once per cycle rather than once per candidate. For large universes, risk-mark quotes focus on held symbols; signal calculations still use the full universe's historical frames.
- Derive available strategy cash from equity less occupied position value/margin. Missing held-position marks prevent new spending.
- Persist strategy cancellation requests scoped by strategy and run. Keep sent orders in `cancel_pending` until broker reconciliation. Preserve partial fills and avoid duplicate fill accounting. Persist cancellation requests across session restoration.
- Remove an order cancelled before its initial queue flush without submitting it. Intercept cancellations arriving during dispatch claim. Never locally confirm an earlier uncertain submission as cancelled: known broker IDs enter reconciliation; unknown IDs remain nonterminal, reserve their slot, and require order reconciliation before retrying.
- Expose data prerequisites through the authoring contract and provide English, Simplified Chinese, and Traditional Chinese error messages.

## Verification

The isolated runner used `quantdinger-backend:local` dependencies with the modified repository bind-mounted. PostgreSQL 18 and Redis 8 ran on a dedicated Docker network, with a fresh `qd_portfolio_test` database. Existing application containers and production data were not changed. The production Docker image was not rebuilt or deployed.

| Check | Result |
| --- | --- |
| Complete backend suite, excluding integration/stress | 2,322 passed; 11 deselected; 35 warnings |
| Opt-in Docker database and fake-broker integration | 6 passed; 2 warnings |
| Frontend tests | 243 passed |
| Frontend production build | Passed; bundle-size warnings remain |
| Ruff and backend structure guardrail | Passed |

The backend suite includes a complete 503-stock synthetic replay of the reference strategy: screening and ranking, 20 buy/sell executions, at most ten simultaneous positions, fee-inclusive entry budgets within USD 1,000, and a flat final portfolio. It also checks live-session order generation and restoration. Synthetic returns are not investment performance evidence.

Database integration covers strategy/run isolation; partial fill of four shares followed by cancellation; repeat synchronization without duplicate accounting; restoring an owned symbol outside the current universe; a cancellation racing the first dispatch; and uncertain previous submissions with and without a broker order ID. Broker calls are replaced by fixtures, so no real orders were placed.

Reproduce inside the configured runner:

```sh
python -m pytest tests -m 'not integration and not stress' -q --disable-warnings
QD_SP500_DOCKER_TEST=1 python -m pytest tests/test_portfolio_docker_integration.py -q
python -m ruff check app scripts tests
python scripts/backend_quality_check.py
```

The integration file additionally refuses to run unless `DATABASE_URL` identifies `qd_portfolio_test`.

## Remaining acceptance requirements

1. Import verified historical S&P 500 membership covering the intended backtest dates. The previously inspected online pool was snapshot-only from 2026-07-18; it cannot substantiate a one-year historical universe.
2. Provide sufficiently complete reported fundamental observations and at least 61 valid prior daily bars. Public vendor history may contain restatements; it is not necessarily an archival as-reported dataset. The code does not retrofit historical observations already imported using guessed availability dates.
3. Verify account permissions, price-feed coverage, buying power, order acceptance, partial fills, cancellation, restart recovery, and fees against an actual Alpaca Paper account. The local fixture checks do not establish brokerage connectivity or live-market behavior.
4. Reconcile any previously submitted order lacking an authoritative broker ID before clearing its reserved slot. The protective hold intentionally does not invent cancellation confirmation.

No production deployment, Git push, or PyPI publication was performed for this change.
