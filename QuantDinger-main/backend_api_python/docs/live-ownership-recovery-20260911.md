# Live ownership and container recovery

## Ownership drift

The shared ownership checks, entry preflight, and account reconciliation view tolerate up to 10 USD/USDT/USDC quote units when a usable current price is available. Existing relative tolerances remain in place. Other quote currencies and missing prices do not receive an assumed USD conversion. Balances and strategy allocations are not rewritten by this tolerance.

Instrument rules now use the existing decimal step-normalization helper to preserve exact lot/tick boundaries after floating-point ledger arithmetic. A genuinely undersized order is still rejected. Position-drift and minimum-size rejections no longer count towards the grid's consecutive-error auto-stop threshold; authentication and other fatal failures still stop execution. Reduce-only sizing continues to respect exchange inventory and protected manual quantity.

The ownership UI shows the difference in quantity and quote value, an immediate review action, and the individual strategy allocations contributing to the total. Negative differences have two distinct paths:

- When account inventory still covers all strategy allocations, an explicit confirmation can reset the obsolete protected manual baseline to the remaining account quantity. This sends no orders and does not modify strategy allocations.
- When strategy allocations alone exceed account inventory, the UI reports an allocation shortfall, removes the inapplicable protect-manual action, and explains that fills/manual sells must be reconciled. It does not fabricate inventory or silently write down any strategy's balance. The screenshot's approximately 0.0061245 BTC difference is about 473 quote units at its displayed price and is outside the 10-unit tolerance.

Ownership reads and repairs request a current account snapshot directly, including for fill-ledger/grid strategies. Partial or failed snapshots cannot change the protected baseline. The recheck no longer relies on a sync path that intentionally skips grid ledgers.

## Worker recovery

Previously the trading worker tried restoration only once on startup. If the old container's strategy lease was still valid, restoration skipped that strategy permanently.

The worker now checks persisted running intentions periodically (15 seconds with the default 30-second lease). Expired leases can be acquired on a subsequent pass. Temporary recovery/query failures do not change the desired state to stopped or crash the initial recovery check. Local instances are skipped, active leases prevent duplicate owners, and queued stop commands plus a fresh desired-state read prevent recovery from overriding a user stop. Strategies already marked stopped after a fatal failure remain stopped.

## Release and validation

Update both `backend` and `trading-worker` services to the new backend build and rebuild the frontend. Restarting only the API container does not load new worker code. No database migration or plugin reinstall is needed. This repair session did not restart online containers or change any live account's allocations.

Regression tests cover signed 10-unit boundaries, missing prices, classified negative differences, protected-baseline updates, rejected repairs on partial snapshots, grid rejection counters, decimal lot edges, takeover after old lease expiry, repeated recovery checks, local duplicate avoidance, and user stop precedence. Online restart/takeover still requires verification after deployment.
