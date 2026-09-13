CREATE TABLE IF NOT EXISTS qd_strategy_broker_activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES qd_users(id) ON DELETE CASCADE,
    strategy_id INTEGER NOT NULL REFERENCES qd_strategies_trading(id) ON DELETE CASCADE,
    credential_id INTEGER NOT NULL DEFAULT 0,
    broker_id VARCHAR(40) NOT NULL DEFAULT '',
    activity_type VARCHAR(24) NOT NULL DEFAULT '',
    activity_subtype VARCHAR(24) NOT NULL DEFAULT '',
    symbol VARCHAR(50) NOT NULL DEFAULT '',
    currency VARCHAR(16) NOT NULL DEFAULT 'USD',
    amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
    account_amount DECIMAL(24, 8) NOT NULL DEFAULT 0,
    allocation_ratio DECIMAL(20, 12) NOT NULL DEFAULT 1,
    allocation_reason VARCHAR(40) NOT NULL DEFAULT '',
    external_id VARCHAR(180) NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (credential_id, broker_id, external_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_activity_strategy_time
ON qd_strategy_broker_activities(strategy_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_broker_activity_credential
ON qd_strategy_broker_activities(credential_id, broker_id, external_id);
