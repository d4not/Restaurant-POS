-- Purchase Orders redesign — Digital + Mandado lifecycle (additive)
-- ─────────────────────────────────────────────────────────────────────────────
-- Single migration that:
--   1. Extends PurchaseStatus with the new lifecycle values
--   2. Adds PurchaseKind + SupplierKind enums
--   3. Adds Supplier.kind / whatsapp_phone / message_template
--   4. Adds Purchase.kind + delivery/errand/verify/cancel fields + runner FK
--   5. Adds PurchaseItem.received_package_quantity / shortfall_reason / unavailable
--   6. Adds CashMovement.reference_type / reference_id + optional Purchase FK
--   7. Data migration: legacy Purchases with status=CONFIRMED → VERIFIED with
--      verified_at = updated_at (so timelines look sane in the new UI).
-- Everything additive — no column drops, no behavior change for legacy code.

-- ─── 1. Extend PurchaseStatus enum ──────────────────────────────────────────
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_SUPPLIER';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'SUPPLIER_REPLIED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'ARRIVED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'DISPATCHED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ─── 2. New enums ────────────────────────────────────────────────────────────
CREATE TYPE "PurchaseKind" AS ENUM ('DELIVERY', 'ERRAND');
CREATE TYPE "SupplierKind" AS ENUM ('DELIVERY', 'ERRAND', 'BOTH');

-- ─── 3. Supplier columns ────────────────────────────────────────────────────
ALTER TABLE "suppliers"
  ADD COLUMN "kind"             "SupplierKind" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "whatsapp_phone"   TEXT,
  ADD COLUMN "message_template" TEXT;

CREATE INDEX "suppliers_kind_idx" ON "suppliers"("kind");

-- ─── 4. Purchase columns ────────────────────────────────────────────────────
ALTER TABLE "purchases"
  ADD COLUMN "kind"                 "PurchaseKind" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "message_sent_at"      TIMESTAMP(3),
  ADD COLUMN "supplier_replied_at"  TIMESTAMP(3),
  ADD COLUMN "supplier_subtotal"    DECIMAL(14,0),
  ADD COLUMN "shipping_cost"        DECIMAL(14,0),
  ADD COLUMN "paid_at"              TIMESTAMP(3),
  ADD COLUMN "payment_reference"    TEXT,
  ADD COLUMN "in_transit_at"        TIMESTAMP(3),
  ADD COLUMN "arrived_at"           TIMESTAMP(3),
  ADD COLUMN "expected_arrival"     TIMESTAMP(3),
  ADD COLUMN "runner_user_id"       UUID,
  ADD COLUMN "cash_advanced"        DECIMAL(14,0),
  ADD COLUMN "cash_returned"        DECIMAL(14,0),
  ADD COLUMN "dispatched_at"        TIMESTAMP(3),
  ADD COLUMN "returned_at"          TIMESTAMP(3),
  ADD COLUMN "verified_at"          TIMESTAMP(3),
  ADD COLUMN "verified_by_user_id"  UUID,
  ADD COLUMN "cancel_reason"        TEXT,
  ADD COLUMN "cancelled_at"         TIMESTAMP(3),
  ADD COLUMN "cancelled_by_user_id" UUID;

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_runner_user_id_fkey"
    FOREIGN KEY ("runner_user_id")       REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchases_verified_by_user_id_fkey"
    FOREIGN KEY ("verified_by_user_id")  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "purchases_cancelled_by_user_id_fkey"
    FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchases_kind_idx"           ON "purchases"("kind");
CREATE INDEX "purchases_runner_user_id_idx" ON "purchases"("runner_user_id");

-- ─── 5. PurchaseItem columns ────────────────────────────────────────────────
ALTER TABLE "purchase_items"
  ADD COLUMN "received_package_quantity" DECIMAL(14,4),
  ADD COLUMN "shortfall_reason"          TEXT,
  ADD COLUMN "unavailable"               BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 6. CashMovement reference fields ──────────────────────────────────────
ALTER TABLE "cash_movements"
  ADD COLUMN "reference_type" TEXT,
  ADD COLUMN "reference_id"   UUID;

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_purchase_fkey"
    FOREIGN KEY ("reference_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cash_movements_reference_type_reference_id_idx"
  ON "cash_movements"("reference_type", "reference_id");

-- ─── 7. Legacy data migration lives in 20260524100001_purchase_orders_legacy.
-- Postgres forbids using a newly-added enum value in the same transaction
-- that added it (SQLSTATE 55P04), so the UPDATE that re-maps CONFIRMED rows
-- to VERIFIED has to ride a separate migration. Column defaults already
-- cover kind=DELIVERY for legacy rows; runner/cash fields stay NULL.
