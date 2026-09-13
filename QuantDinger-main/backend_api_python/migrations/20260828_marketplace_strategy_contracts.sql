-- Versioned, queryable applicability contracts for marketplace strategies.
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_contract jsonb DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_contract_version int4 DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_contract_hash varchar(64) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_binding_mode varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_type varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_direction_mode varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_primary_frequency varchar(16) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_markets varchar(255) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_market_types varchar(255) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS strategy_timeframes varchar(255) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_indicator_strategy_binding ON qd_indicator_codes USING btree (strategy_binding_mode);
CREATE INDEX IF NOT EXISTS idx_indicator_strategy_type ON qd_indicator_codes USING btree (strategy_type);
CREATE INDEX IF NOT EXISTS idx_indicator_strategy_frequency ON qd_indicator_codes USING btree (strategy_primary_frequency);
