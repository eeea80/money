# Alpaca manual inventory protection

Alpaca stocks and crypto now support explicit manual inventory baselines in
the position ownership dialog. Updating a baseline does not submit an order.
The account's unallocated quantity is protected separately from all strategies.

The Alpaca worker checks ownership immediately before submission. Closing
quantity is capped by the requesting strategy's recorded allocation and the
account inventory remaining after manual protection and other allocations.
Opening a position against the account's opposite leg is rejected because
Alpaca nets positions. Long holdings and short liabilities are both supported.

Account submissions and repairs share a PostgreSQL advisory transaction lock.
Pending broker orders, local orders awaiting reconciliation, and fills missing
from the trade ledger block further submissions or repairs for that symbol.
Worker lock/order contention retries with a five-second delay within the
existing attempt limit, then rejects the intent. Existing broker protective
orders are not cancelled automatically. Review them before retrying an exit.
Unavailable or incomplete broker snapshots fail closed.

Alpaca ownership uses the spot ledger bucket. Existing USStock/crypto rows and
legacy rows with a missing credential but a matching strategy credential are
included in allocation checks. Stock instruments have distinct account keys.
The crypto USD 10 drift rule is not extended to stocks. Exit quantity caps
never use drift tolerance to spend protected inventory.

Deploy the backend image to the API and pending-order workers, and deploy the
frontend together. No schema migration or MCP/PyPI release is required. Refresh
the ownership dialog, review the current account and strategy quantities, then
choose the manual protection action for each desired instrument and direction.
Existing holdings are not adopted or modified automatically.

This is application ledger protection, not segregated broker custody. Manual
trades outside QuantDinger, broker liquidation, and previously submitted orders
can still change account inventory. Keep the account reconciled before trading.

Validation uses fake brokers plus `tests/integration/check_alpaca_ownership_postgres.py`,
which creates and removes a unique test schema without reading business tables.
