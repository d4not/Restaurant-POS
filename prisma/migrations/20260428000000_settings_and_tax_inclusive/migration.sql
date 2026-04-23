-- Settings — generic singleton key/value store. First consumer is the
-- "default_tax_id" entry used by tax-inclusive pricing.
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- OrderItem.base_amount — revenue portion extracted from the tax-inclusive
-- line_total. Defaults to line_total for existing rows so pre-existing orders
-- (which treated tax as on top) still have a coherent base; new writes set
-- base_amount = line_total - tax_amount under the tax-inclusive formula.
ALTER TABLE "order_items" ADD COLUMN "base_amount" DECIMAL(14,0) NOT NULL DEFAULT 0;

-- Backfill: for already-paid / in-progress orders, make base_amount = line_total
-- so existing totals don't go out of sync. New orders overwrite this on insert.
UPDATE "order_items" SET "base_amount" = "line_total" WHERE "base_amount" = 0;
