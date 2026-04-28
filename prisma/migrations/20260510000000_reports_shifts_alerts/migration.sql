-- Reports, provisional shifts, alerts.
--
-- Adds the workflow described in docs/REPORTS-SPEC.md:
--   * Provisional-shift verification fields on cash_registers (a parallel
--     `type` column to the older `kind`, plus the verified_* trio).
--   * shift_reports — immutable per-shift snapshot generated when a shift
--     closes. All money in centavos as integers.
--   * daily_reports — consolidated end-of-day report. Folio is a global
--     auto-incrementing counter (frontend prefixes "Z-").
--   * alerts — auto-generated signals (cash shortage, excessive voids…)
--     resolved by a manager+ with a note.
--   * Seeds the six alert_* threshold settings consumed by the alert
--     generator (idempotent via ON CONFLICT (key) DO NOTHING).

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('REGULAR', 'PROVISIONAL');

-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CASH_SHORTAGE', 'CASH_SURPLUS', 'RECURRING_SHORTAGE', 'EXCESSIVE_VOIDS', 'EXCESSIVE_DISCOUNTS', 'UNVERIFIED_PROVISIONAL', 'LATE_VOID');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "cash_registers" ADD COLUMN     "daily_report_id" UUID,
ADD COLUMN     "parent_shift_id" UUID,
ADD COLUMN     "requires_verification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" "ShiftType" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "verification_notes" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by_id" UUID;

-- CreateTable
CREATE TABLE "shift_reports" (
    "id" UUID NOT NULL,
    "cash_register_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_role" TEXT NOT NULL,
    "shift_type" "ShiftType" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,
    "gross_sales" INTEGER NOT NULL DEFAULT 0,
    "discounts" INTEGER NOT NULL DEFAULT 0,
    "comps" INTEGER NOT NULL DEFAULT 0,
    "void_total" INTEGER NOT NULL DEFAULT 0,
    "void_count" INTEGER NOT NULL DEFAULT 0,
    "net_sales" INTEGER NOT NULL DEFAULT 0,
    "tax_collected" INTEGER NOT NULL DEFAULT 0,
    "total_tickets" INTEGER NOT NULL DEFAULT 0,
    "avg_ticket" INTEGER NOT NULL DEFAULT 0,
    "cash_sales" INTEGER NOT NULL DEFAULT 0,
    "card_sales" INTEGER NOT NULL DEFAULT 0,
    "transfer_sales" INTEGER NOT NULL DEFAULT 0,
    "other_sales" INTEGER NOT NULL DEFAULT 0,
    "opening_amount" INTEGER NOT NULL DEFAULT 0,
    "cash_in" INTEGER NOT NULL DEFAULT 0,
    "cash_out" INTEGER NOT NULL DEFAULT 0,
    "expected_cash" INTEGER NOT NULL DEFAULT 0,
    "actual_cash" INTEGER,
    "cash_variance" INTEGER,
    "sales_by_category" JSONB NOT NULL DEFAULT '[]',
    "top_products" JSONB NOT NULL DEFAULT '[]',
    "verified_by_id" UUID,
    "verified_by_name" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "folio" SERIAL NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'OPEN',
    "gross_sales" INTEGER NOT NULL DEFAULT 0,
    "discounts" INTEGER NOT NULL DEFAULT 0,
    "comps" INTEGER NOT NULL DEFAULT 0,
    "void_total" INTEGER NOT NULL DEFAULT 0,
    "void_count" INTEGER NOT NULL DEFAULT 0,
    "net_sales" INTEGER NOT NULL DEFAULT 0,
    "tax_collected" INTEGER NOT NULL DEFAULT 0,
    "total_tickets" INTEGER NOT NULL DEFAULT 0,
    "avg_ticket" INTEGER NOT NULL DEFAULT 0,
    "cash_sales" INTEGER NOT NULL DEFAULT 0,
    "card_sales" INTEGER NOT NULL DEFAULT 0,
    "transfer_sales" INTEGER NOT NULL DEFAULT 0,
    "other_sales" INTEGER NOT NULL DEFAULT 0,
    "total_opening_amount" INTEGER NOT NULL DEFAULT 0,
    "total_cash_in" INTEGER NOT NULL DEFAULT 0,
    "total_cash_out" INTEGER NOT NULL DEFAULT 0,
    "total_expected_cash" INTEGER NOT NULL DEFAULT 0,
    "total_actual_cash" INTEGER,
    "total_cash_variance" INTEGER,
    "sales_by_category" JSONB NOT NULL DEFAULT '[]',
    "top_products" JSONB NOT NULL DEFAULT '[]',
    "bottom_products" JSONB NOT NULL DEFAULT '[]',
    "sales_by_hour" JSONB NOT NULL DEFAULT '[]',
    "total_shifts" INTEGER NOT NULL DEFAULT 0,
    "provisional_shifts" INTEGER NOT NULL DEFAULT 0,
    "unverified_provisionals" INTEGER NOT NULL DEFAULT 0,
    "peak_hour" INTEGER,
    "slowest_hour" INTEGER,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "user_id" UUID,
    "shift_report_id" UUID,
    "daily_report_id" UUID,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_reports_cash_register_id_key" ON "shift_reports"("cash_register_id");

-- CreateIndex
CREATE INDEX "shift_reports_user_id_idx" ON "shift_reports"("user_id");

-- CreateIndex
CREATE INDEX "shift_reports_created_at_idx" ON "shift_reports"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_date_key" ON "daily_reports"("date");

-- CreateIndex
CREATE INDEX "daily_reports_date_idx" ON "daily_reports"("date");

-- CreateIndex
CREATE INDEX "daily_reports_status_idx" ON "daily_reports"("status");

-- CreateIndex
CREATE INDEX "alerts_type_resolved_idx" ON "alerts"("type", "resolved");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_user_id_idx" ON "alerts"("user_id");

-- CreateIndex
CREATE INDEX "alerts_shift_report_id_idx" ON "alerts"("shift_report_id");

-- CreateIndex
CREATE INDEX "alerts_daily_report_id_idx" ON "alerts"("daily_report_id");

-- CreateIndex
CREATE INDEX "cash_registers_type_idx" ON "cash_registers"("type");

-- CreateIndex
CREATE INDEX "cash_registers_parent_shift_id_idx" ON "cash_registers"("parent_shift_id");

-- CreateIndex
CREATE INDEX "cash_registers_daily_report_id_idx" ON "cash_registers"("daily_report_id");

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_parent_shift_id_fkey" FOREIGN KEY ("parent_shift_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_shift_report_id_fkey" FOREIGN KEY ("shift_report_id") REFERENCES "shift_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_daily_report_id_fkey" FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed alert thresholds. Idempotent so re-applying the migration on a partially
-- seeded DB doesn't blow up. Settings.id has no DB-level default, so a UUID is
-- generated here via gen_random_uuid() (the pgcrypto / pg-builtin in 14+).
INSERT INTO "settings" ("id", "key", "value", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'alert_cash_shortage_threshold',  '2000', NOW(), NOW()),
  (gen_random_uuid(), 'alert_cash_surplus_threshold',   '2000', NOW(), NOW()),
  (gen_random_uuid(), 'alert_max_voids_per_shift',      '3',    NOW(), NOW()),
  (gen_random_uuid(), 'alert_max_discount_pct',         '10',   NOW(), NOW()),
  (gen_random_uuid(), 'alert_recurring_shortage_count', '3',    NOW(), NOW()),
  (gen_random_uuid(), 'alert_recurring_shortage_min',   '500',  NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
