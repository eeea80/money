CREATE TABLE IF NOT EXISTS qd_fundamental_sync_jobs (
    id BIGSERIAL PRIMARY KEY,
    universe_id BIGINT NOT NULL REFERENCES qd_universes(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES qd_users(id) ON DELETE CASCADE,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('history', 'current')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    fields_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fundamental_sync_active
    ON qd_fundamental_sync_jobs(universe_id) WHERE status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS qd_fundamental_sync_items (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES qd_fundamental_sync_jobs(id) ON DELETE CASCADE,
    market VARCHAR(50) NOT NULL,
    symbol VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    token VARCHAR(40),
    lease_until TIMESTAMPTZ,
    retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error VARCHAR(200) NOT NULL DEFAULT '',
    error_detail VARCHAR(500) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id, market, symbol)
);
CREATE INDEX IF NOT EXISTS idx_fundamental_sync_pending ON qd_fundamental_sync_items(status, retry_at);
CREATE TABLE IF NOT EXISTS qd_fundamental_sync_schedules (
    id BIGSERIAL PRIMARY KEY,
    universe_id BIGINT NOT NULL UNIQUE REFERENCES qd_universes(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES qd_users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mode VARCHAR(20) NOT NULL DEFAULT 'history',
    fields_json JSONB NOT NULL DEFAULT '["revenue", "net_income", "net_income_ttm", "book_value", "shareholder_equity", "total_debt", "free_cash_flow", "shares_outstanding", "market_cap", "pe_ratio", "pb_ratio", "return_on_equity", "revenue_growth", "debt_to_equity"]'::jsonb,
    next_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qd_fundamental_sync_jobs ADD COLUMN IF NOT EXISTS refresh_policy VARCHAR(20) NOT NULL DEFAULT 'full';
ALTER TABLE qd_fundamental_sync_jobs ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE qd_fundamental_sync_items ADD COLUMN IF NOT EXISTS error_detail VARCHAR(500) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_fundamental_sync_symbol_check ON qd_fundamental_sync_items(market, symbol, updated_at DESC);
