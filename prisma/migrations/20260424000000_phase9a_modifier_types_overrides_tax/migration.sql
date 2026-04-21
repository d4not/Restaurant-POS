-- Phase 9A: SWAP/ADD modifier groups, per-modifier ratio, per-product overrides,
-- and per-OrderItem tax snapshot.

-- Enums
CREATE TYPE "ModifierGroupType" AS ENUM ('SWAP', 'ADD');
CREATE TYPE "ModifierOverrideType" AS ENUM ('RATIO', 'FIXED_QTY');

-- ModifierGroup gains type + replaces_supply_id (SWAP target).
ALTER TABLE "modifier_groups"
  ADD COLUMN "type" "ModifierGroupType" NOT NULL DEFAULT 'ADD',
  ADD COLUMN "replaces_supply_id" UUID;

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_replaces_supply_id_fkey"
    FOREIGN KEY ("replaces_supply_id") REFERENCES "supplies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "modifier_groups_replaces_supply_id_idx"
  ON "modifier_groups" ("replaces_supply_id");

-- Modifier gains a ratio (default 1.0 = "same amount as original ingredient").
ALTER TABLE "modifiers"
  ADD COLUMN "ratio" DECIMAL(10, 4) NOT NULL DEFAULT 1;

-- Per-product overrides for modifier deduction semantics.
CREATE TABLE "modifier_product_overrides" (
  "id"                UUID NOT NULL,
  "product_id"        UUID NOT NULL,
  "modifier_id"       UUID NOT NULL,
  "override_type"     "ModifierOverrideType" NOT NULL,
  "override_ratio"    DECIMAL(10, 4),
  "override_quantity" DECIMAL(14, 4),
  "override_unit"     TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modifier_product_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modifier_product_overrides_product_id_modifier_id_key"
  ON "modifier_product_overrides" ("product_id", "modifier_id");
CREATE INDEX "modifier_product_overrides_product_id_idx"
  ON "modifier_product_overrides" ("product_id");
CREATE INDEX "modifier_product_overrides_modifier_id_idx"
  ON "modifier_product_overrides" ("modifier_id");

ALTER TABLE "modifier_product_overrides"
  ADD CONSTRAINT "modifier_product_overrides_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "modifier_product_overrides"
  ADD CONSTRAINT "modifier_product_overrides_modifier_id_fkey"
    FOREIGN KEY ("modifier_id") REFERENCES "modifiers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- OrderItem gains per-line tax snapshot. Defaults cover existing rows.
ALTER TABLE "order_items"
  ADD COLUMN "tax_rate"   DECIMAL(6, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "tax_amount" DECIMAL(14, 0) NOT NULL DEFAULT 0;
