-- Extend PurchasePackaging with last known price and a primary-supplier flag.
-- price_per_package is in centavos (Decimal 14,0) and nullable — legacy rows
-- have no recorded price until the first purchase is registered.
ALTER TABLE "purchase_packagings"
  ADD COLUMN "price_per_package" DECIMAL(14, 0),
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- Compound index used by the supplies detail page to fetch the primary
-- packaging for a given supply in one hit.
CREATE INDEX "purchase_packagings_supply_id_is_primary_idx"
  ON "purchase_packagings" ("supply_id", "is_primary");
