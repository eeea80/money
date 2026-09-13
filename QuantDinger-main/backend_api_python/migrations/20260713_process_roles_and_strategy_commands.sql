-- =============================================================================
-- Durable process roles, strategy commands, runtime leases, and worker health
-- =============================================================================

CREATE TABLE IF NOT EXISTS qd_strategy_commands (
    id BIGSERIAL PRIMARY KEY,
    strategy_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    command_type VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP NOT NULL DEFAULT NOW(),
    claimed_by VARCHAR(160) NOT NULL DEFAULT '',
    claimed_at TIMESTAMP,
    lease_expires_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (command_type IN ('start', 'stop', 'restart', 'reconcile')),
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_strategy_commands_claim
    ON qd_strategy_commands(status, available_at, id);
CREATE INDEX IF NOT EXISTS idx_strategy_commands_strategy
    ON qd_strategy_commands(strategy_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_commands_active_action
    ON qd_strategy_commands(strategy_id, command_type)
    WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS qd_strategy_runtime_leases (
    strategy_id INTEGER PRIMARY KEY,
    owner_id VARCHAR(160) NOT NULL,
    fencing_token BIGINT NOT NULL DEFAULT 1,
    lease_expires_at TIMESTAMP NOT NULL,
    heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strategy_runtime_leases_expiry
    ON qd_strategy_runtime_leases(lease_expires_at);

CREATE TABLE IF NOT EXISTS qd_worker_heartbeats (
    worker_id VARCHAR(160) PRIMARY KEY,
    role VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'running',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (role IN ('api', 'trading', 'scheduler', 'celery', 'celery-beat')),
    CHECK (status IN ('running', 'stopped', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_role
    ON qd_worker_heartbeats(role, heartbeat_at DESC);
CREATE TABLE IF NOT EXISTS qd_process_leases (
    lease_key VARCHAR(128) PRIMARY KEY,
    owner_id VARCHAR(160) NOT NULL,
    lease_expires_at TIMESTAMP NOT NULL,
    heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_process_leases_expiry
    ON qd_process_leases(lease_expires_at);
