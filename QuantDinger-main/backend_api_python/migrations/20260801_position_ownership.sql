-- Protected manual position baselines and per-leg drift blocking.
CREATE TABLE IF NOT EXISTS qd_position_reservations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES qd_users(id) ON DELETE CASCADE,
    credential_id INTEGER NOT NULL DEFAULT 0,
    exchange_id VARCHAR(40) NOT NULL DEFAULT '',
    market_type VARCHAR(20) NOT NULL DEFAULT 'swap',
    inst_id VARCHAR(80) NOT NULL DEFAULT '',
    symbol VARCHAR(50) NOT NULL DEFAULT '',
    symbol_canonical VARCHAR(50) NOT NULL DEFAULT '',
    side VARCHAR(10) NOT NULL DEFAULT '',
    coexistence_mode VARCHAR(20) NOT NULL DEFAULT 'strict',
    manual_reserved_qty DECIMAL(24, 8) NOT NULL DEFAULT 0,
    observed_account_qty DECIMAL(24, 8) NOT NULL DEFAULT 0,
    allocated_qty DECIMAL(24, 8) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'ok',
    drift_reason VARCHAR(80) NOT NULL DEFAULT '',
    last_log_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, credential_id, market_type, symbol_canonical, side)
);

CREATE INDEX IF NOT EXISTS idx_position_reservation_leg
    ON qd_position_reservations(credential_id, market_type, symbol_canonical, side);
CREATE INDEX IF NOT EXISTS idx_position_reservation_blocked
    ON qd_position_reservations(user_id, status);
