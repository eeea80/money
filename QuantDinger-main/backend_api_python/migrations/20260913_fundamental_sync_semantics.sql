ALTER TABLE qd_fundamental_sync_items
    ADD COLUMN IF NOT EXISTS error_detail VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE qd_fundamental_sync_schedules
    ALTER COLUMN fields_json SET DEFAULT '["revenue", "net_income", "net_income_ttm", "book_value", "shareholder_equity", "total_debt", "free_cash_flow", "shares_outstanding", "market_cap", "pe_ratio", "pb_ratio", "return_on_equity", "revenue_growth", "debt_to_equity"]'::jsonb;
