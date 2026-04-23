-- Phase 10 — Zones & Tables. Floor management for dine-in service. Zones group
-- tables (Indoor / Terrace / Bar Area); each table has a per-zone display
-- number, capacity, and a status badge driven by the Order lifecycle.

CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED');

CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- Per-zone uniqueness — two zones can each have a "Table 1".
CREATE UNIQUE INDEX "tables_zone_id_number_key" ON "tables"("zone_id", "number");
CREATE INDEX "tables_zone_id_idx" ON "tables"("zone_id");
CREATE INDEX "tables_status_idx" ON "tables"("status");

ALTER TABLE "tables"
    ADD CONSTRAINT "tables_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "zones"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Order ←→ Table link. SET NULL on delete so wiping a retired table doesn't
-- destroy historical orders.
ALTER TABLE "orders" ADD COLUMN "table_id" UUID;
CREATE INDEX "orders_table_id_idx" ON "orders"("table_id");
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "tables"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
