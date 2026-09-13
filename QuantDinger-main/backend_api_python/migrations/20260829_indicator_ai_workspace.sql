BEGIN;

CREATE TABLE IF NOT EXISTS qd_ai_workspace_threads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  asset_type VARCHAR(32) NOT NULL,
  asset_id INTEGER NOT NULL,
  title VARCHAR(255) DEFAULT '',
  summary_json TEXT,
  summary_until_message_id INTEGER,
  summary_version INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, asset_type, asset_id)
);

CREATE TABLE IF NOT EXISTS qd_ai_workspace_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES qd_ai_workspace_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(32) DEFAULT 'chat',
  change_id INTEGER,
  metadata_json TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qd_ai_workspace_changes (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES qd_ai_workspace_threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  asset_type VARCHAR(32) NOT NULL,
  asset_id INTEGER NOT NULL,
  base_code_hash VARCHAR(64) NOT NULL,
  candidate_code TEXT NOT NULL,
  change_summary_json TEXT,
  validation_json TEXT,
  status VARCHAR(24) DEFAULT 'candidate',
  applied_version_no INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_threads_asset ON qd_ai_workspace_threads(user_id, asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_messages_thread ON qd_ai_workspace_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_changes_thread ON qd_ai_workspace_changes(thread_id, id);

COMMIT;
