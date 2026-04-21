-- Partial index for the low-stock alert query: only rows with a configured
-- min_stock are candidates, so the rest are dead weight in the index.
CREATE INDEX "storage_stocks_min_stock_present_idx"
  ON "storage_stocks" ("storage_id", "supply_id")
  WHERE "min_stock" IS NOT NULL;

-- Compound index for the variance / supply-movement reports, which always
-- filter by supply_id (+ optional storage_id) over a date window.
CREATE INDEX "stock_movements_supply_id_created_at_idx"
  ON "stock_movements" ("supply_id", "created_at");

CREATE INDEX "stock_movements_storage_id_created_at_idx"
  ON "stock_movements" ("storage_id", "created_at");
