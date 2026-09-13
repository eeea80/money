CREATE TABLE IF NOT EXISTS qd_strategy_funding_fees (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES qd_users(id) ON DELETE CASCADE,
    strategy_id INTEGER NOT NULL REFERENCES qd_strategies_trading(id) ON DELETE CASCADE,
    credential_id INTEGER NOT NULL DEFAULT 0,
    exchange_id VARCHAR(40) NOT NULL DEFAULT '',
    symbol VARCHAR(50) NOT NULL DEFAULT '',
    asset VARCHAR(20) NOT NULL DEFAULT 'USDT',
    amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
    allocation_ratio DECIMAL(20, 12) NOT NULL DEFAULT 1,
    external_id VARCHAR(160) NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (credential_id, exchange_id, external_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_funding_strategy_time
ON qd_strategy_funding_fees(strategy_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_strategy_funding_credential
ON qd_strategy_funding_fees(credential_id, exchange_id, external_id);
