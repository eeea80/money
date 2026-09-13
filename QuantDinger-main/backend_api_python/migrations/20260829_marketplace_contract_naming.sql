-- Canonical marketplace-only metadata.  These columns describe how a
-- published Strategy V2 source should be discovered and presented; they are
-- deliberately separate from the Strategy V2 runtime/deployment contract.
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_contract jsonb DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_contract_version int4 DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_contract_hash varchar(64) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_binding_mode varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_strategy_type varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_direction_mode varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_execution_mode varchar(24) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_execution_frequency varchar(16) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_confirmation_frequencies varchar(255) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_markets varchar(255) DEFAULT NULL;
ALTER TABLE qd_indicator_codes ADD COLUMN IF NOT EXISTS marketplace_market_types varchar(255) DEFAULT NULL;

-- Non-destructive compatibility migration from the ambiguous v1 names.  The
-- old columns remain read-only rollback data and can be removed in a later
-- major migration after every deployed client has moved to marketplace_*.
UPDATE qd_indicator_codes
SET marketplace_contract = COALESCE(
        marketplace_contract,
        CASE WHEN strategy_contract IS NULL THEN NULL ELSE
          strategy_contract || jsonb_build_object(
            'contract_version', 2,
            'execution_mode', COALESCE(
              strategy_contract->>'execution_mode',
              CASE
                WHEN code ~ E'run_(daily|weekly|monthly)\\s*\\(' AND code ~ E'def\\s+handle_data\\s*\\(' THEN 'hybrid'
                WHEN code ~ E'run_(daily|weekly|monthly)\\s*\\(' THEN 'scheduled'
                ELSE 'bar'
              END
            ),
            'execution_frequency', COALESCE(
              strategy_contract->>'execution_frequency',
              strategy_contract->>'driving_frequency',
              strategy_contract->>'primary_frequency',
              ''
            ),
            'confirmation_frequencies', COALESCE(
              strategy_contract->'confirmation_frequencies',
              (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
               FROM jsonb_array_elements_text(COALESCE(strategy_contract->'frequencies', '[]'::jsonb)) AS f(value)
               WHERE value <> COALESCE(
                 strategy_contract->>'execution_frequency',
                 strategy_contract->>'driving_frequency',
                 strategy_contract->>'primary_frequency',
                 ''
               ))
            )
          )
        END
    ),
    marketplace_contract_version = COALESCE(
        marketplace_contract_version,
        CASE WHEN strategy_contract IS NULL THEN NULL ELSE 2 END
    ),
    marketplace_contract_hash = COALESCE(marketplace_contract_hash, strategy_contract_hash),
    marketplace_binding_mode = COALESCE(marketplace_binding_mode, strategy_binding_mode),
    marketplace_strategy_type = COALESCE(marketplace_strategy_type, strategy_type),
    marketplace_direction_mode = COALESCE(marketplace_direction_mode, strategy_direction_mode),
    marketplace_execution_mode = COALESCE(
        marketplace_execution_mode,
        strategy_contract->>'execution_mode',
        CASE
          WHEN code ~ E'run_(daily|weekly|monthly)\\s*\\(' AND code ~ E'def\\s+handle_data\\s*\\(' THEN 'hybrid'
          WHEN code ~ E'run_(daily|weekly|monthly)\\s*\\(' THEN 'scheduled'
          ELSE 'bar'
        END
    ),
    marketplace_execution_frequency = COALESCE(
        marketplace_execution_frequency,
        strategy_contract->>'execution_frequency',
        strategy_primary_frequency
    ),
    marketplace_confirmation_frequencies = COALESCE(
        marketplace_confirmation_frequencies,
        CASE WHEN jsonb_exists(marketplace_contract, 'confirmation_frequencies') THEN
          '|' || array_to_string(
            ARRAY(SELECT jsonb_array_elements_text(marketplace_contract->'confirmation_frequencies')),
            '|'
          ) || '|'
        ELSE NULL END
    ),
    marketplace_markets = COALESCE(marketplace_markets, strategy_markets),
    marketplace_market_types = COALESCE(marketplace_market_types, strategy_market_types)
WHERE COALESCE(asset_type, 'indicator') = 'script_template';

-- PostgreSQL evaluates UPDATE expressions from the pre-update row.  Populate
-- this search index in a second pass so a contract copied above is visible.
UPDATE qd_indicator_codes
SET marketplace_confirmation_frequencies = CASE
      WHEN jsonb_array_length(COALESCE(marketplace_contract->'confirmation_frequencies', '[]'::jsonb)) = 0
        THEN NULL
      ELSE '|' || array_to_string(
        ARRAY(SELECT jsonb_array_elements_text(marketplace_contract->'confirmation_frequencies')),
        '|'
      ) || '|'
    END
WHERE COALESCE(asset_type, 'indicator') = 'script_template'
  AND marketplace_contract IS NOT NULL
  AND marketplace_confirmation_frequencies IS NULL;

CREATE INDEX IF NOT EXISTS idx_indicator_marketplace_binding
  ON qd_indicator_codes USING btree (marketplace_binding_mode);
CREATE INDEX IF NOT EXISTS idx_indicator_marketplace_strategy_type
  ON qd_indicator_codes USING btree (marketplace_strategy_type);
CREATE INDEX IF NOT EXISTS idx_indicator_marketplace_execution_mode
  ON qd_indicator_codes USING btree (marketplace_execution_mode);
CREATE INDEX IF NOT EXISTS idx_indicator_marketplace_execution_frequency
  ON qd_indicator_codes USING btree (marketplace_execution_frequency);
