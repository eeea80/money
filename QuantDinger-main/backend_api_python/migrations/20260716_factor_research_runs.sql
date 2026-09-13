CREATE TABLE IF NOT EXISTS qd_factor_research_runs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES qd_users(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL,
    source_name VARCHAR(255) DEFAULT '',
    market VARCHAR(100) DEFAULT '',
    timeframe VARCHAR(10) DEFAULT '',
    start_date VARCHAR(20) NOT NULL DEFAULT '',
    end_date VARCHAR(20) NOT NULL DEFAULT '',
    factor_id VARCHAR(64) NOT NULL DEFAULT '',
    groups_count INTEGER NOT NULL DEFAULT 5,
    holding_period INTEGER NOT NULL DEFAULT 5,
    commission DECIMAL(10,6) DEFAULT 0.001,
    slippage DECIMAL(10,6) DEFAULT 0,
    neutralize_industry BOOLEAN NOT NULL DEFAULT FALSE,
    universe_size INTEGER NOT NULL DEFAULT 0,
    manifest_json TEXT NOT NULL DEFAULT '{}',
    code_hash VARCHAR(128) DEFAULT '',
    result_json TEXT NOT NULL DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factor_research_runs_user_id
  ON qd_factor_research_runs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_factor_research_runs_source_id
  ON qd_factor_research_runs(source_id, id DESC);
