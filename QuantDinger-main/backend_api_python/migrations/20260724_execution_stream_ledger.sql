-- Durable, idempotent live execution events and actual fee components.
-- init.sql contains the same definitions for fresh installations.

ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS client_order_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS fee_status VARCHAR(24) NOT NULL DEFAULT 'pending';
ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS fee_source VARCHAR(24) NOT NULL DEFAULT '';

ALTER TABLE qd_strategy_trades ADD COLUMN IF NOT EXISTS execution_event_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE qd_strategy_trades ADD COLUMN IF NOT EXISTS exchange_fill_id VARCHAR(160) NOT NULL DEFAULT '';
ALTER TABLE qd_strategy_trades ADD COLUMN IF NOT EXISTS fee_status VARCHAR(24) NOT NULL DEFAULT 'pending';
ALTER TABLE qd_strategy_trades ADD COLUMN IF NOT EXISTS fee_source VARCHAR(24) NOT NULL DEFAULT '';
ALTER TABLE qd_strategy_trades ADD COLUMN IF NOT EXISTS grid_order_id BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_trades_execution_event
  ON qd_strategy_trades(execution_event_id) WHERE execution_event_id > 0;
CREATE INDEX IF NOT EXISTS idx_strategy_trades_grid_order
  ON qd_strategy_trades(grid_order_id) WHERE grid_order_id > 0;

ALTER TABLE strategy_order_fills ADD COLUMN IF NOT EXISTS credential_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE strategy_order_fills ADD COLUMN IF NOT EXISTS commission_quote DECIMAL(28, 12);
ALTER TABLE strategy_order_fills ADD COLUMN IF NOT EXISTS fee_status VARCHAR(24) NOT NULL DEFAULT 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_order_fills_exchange_fill
  ON strategy_order_fills(exchange_id, credential_id, exchange_fill_id)
  WHERE exchange_fill_id <> '';

CREATE TABLE IF NOT EXISTS qd_live_order_bindings (
    id BIGSERIAL PRIMARY KEY,
    credential_id INTEGER NOT NULL DEFAULT 0,
    exchange_id VARCHAR(50) NOT NULL,
    market_type VARCHAR(20) NOT NULL DEFAULT 'swap',
    owner_type VARCHAR(24) NOT NULL,
    owner_id BIGINT NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL DEFAULT 1,
    strategy_id INTEGER NOT NULL DEFAULT 0,
    pending_order_id BIGINT NOT NULL DEFAULT 0,
    strategy_run_id BIGINT NOT NULL DEFAULT 0,
    order_intent_id BIGINT NOT NULL DEFAULT 0,
    symbol VARCHAR(80) NOT NULL DEFAULT '',
    signal_type VARCHAR(40) NOT NULL DEFAULT '',
    client_order_id VARCHAR(100) NOT NULL DEFAULT '',
    exchange_order_id VARCHAR(160) NOT NULL DEFAULT '',
    observed_filled DECIMAL(28, 12) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_order_binding_owner
  ON qd_live_order_bindings(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_live_order_binding_client
  ON qd_live_order_bindings(credential_id, exchange_id, market_type, client_order_id);
CREATE INDEX IF NOT EXISTS idx_live_order_binding_exchange
  ON qd_live_order_bindings(credential_id, exchange_id, market_type, exchange_order_id);

CREATE TABLE IF NOT EXISTS qd_execution_events (
    id BIGSERIAL PRIMARY KEY,
    event_key VARCHAR(320) NOT NULL UNIQUE,
    credential_id INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL DEFAULT 1,
    exchange_id VARCHAR(50) NOT NULL,
    market_type VARCHAR(20) NOT NULL DEFAULT 'swap',
    account_id VARCHAR(128) NOT NULL DEFAULT '',
    symbol VARCHAR(80) NOT NULL DEFAULT '',
    exchange_order_id VARCHAR(160) NOT NULL DEFAULT '',
    client_order_id VARCHAR(100) NOT NULL DEFAULT '',
    exchange_fill_id VARCHAR(160) NOT NULL DEFAULT '',
    side VARCHAR(12) NOT NULL DEFAULT '',
    position_side VARCHAR(12) NOT NULL DEFAULT '',
    order_status VARCHAR(24) NOT NULL DEFAULT '',
    price DECIMAL(28, 12) NOT NULL DEFAULT 0,
    quantity DECIMAL(28, 12) NOT NULL DEFAULT 0,
    cumulative_quantity DECIMAL(28, 12) NOT NULL DEFAULT 0,
    is_cumulative BOOLEAN NOT NULL DEFAULT FALSE,
    realized_pnl DECIMAL(28, 12),
    maker BOOLEAN,
    fee_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    occurred_at TIMESTAMP NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_at TIMESTAMP,
    process_attempts INTEGER NOT NULL DEFAULT 0,
    process_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_execution_events_pending
  ON qd_execution_events(received_at, id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_execution_events_order
  ON qd_execution_events(credential_id, exchange_id, market_type, exchange_order_id);

CREATE TABLE IF NOT EXISTS qd_execution_fee_components (
    id BIGSERIAL PRIMARY KEY,
    execution_event_id BIGINT NOT NULL REFERENCES qd_execution_events(id) ON DELETE CASCADE,
    fee_type VARCHAR(24) NOT NULL DEFAULT 'trade',
    currency VARCHAR(24) NOT NULL DEFAULT '',
    amount DECIMAL(28, 12) NOT NULL DEFAULT 0,
    quote_amount DECIMAL(28, 12),
    source VARCHAR(24) NOT NULL DEFAULT 'websocket',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(execution_event_id, fee_type, currency)
);
CREATE INDEX IF NOT EXISTS idx_execution_fee_event
  ON qd_execution_fee_components(execution_event_id);

CREATE TABLE IF NOT EXISTS qd_execution_fee_projections (
    execution_event_id BIGINT PRIMARY KEY REFERENCES qd_execution_events(id) ON DELETE CASCADE,
    pending_order_id BIGINT NOT NULL DEFAULT 0,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qd_execution_owner_projections (
    execution_event_id BIGINT NOT NULL REFERENCES qd_execution_events(id) ON DELETE CASCADE,
    owner_type VARCHAR(24) NOT NULL,
    owner_id BIGINT NOT NULL DEFAULT 0,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (execution_event_id, owner_type, owner_id)
);

CREATE TABLE IF NOT EXISTS qd_execution_stream_health (
    stream_key VARCHAR(180) PRIMARY KEY,
    credential_id INTEGER NOT NULL DEFAULT 0,
    exchange_id VARCHAR(50) NOT NULL,
    market_type VARCHAR(20) NOT NULL DEFAULT '',
    state VARCHAR(24) NOT NULL DEFAULT 'stopped',
    last_event_at TIMESTAMP,
    last_connected_at TIMESTAMP,
    last_disconnected_at TIMESTAMP,
    reconnect_count INTEGER NOT NULL DEFAULT 0,
    rest_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
