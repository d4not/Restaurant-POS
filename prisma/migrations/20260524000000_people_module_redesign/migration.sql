-- People module redesign: schedule, payroll adjustments, tips
-- Phase 11 — adds the data model for recurring weekly schedules, itemized
-- payroll bonuses/deductions, and a weekly tip pool with per-employee
-- allocations. Existing PayrollPeriod columns `deductions` and `bonuses`
-- become mirrors maintained by the service so existing API consumers keep
-- the same shape; new code reads the decomposed columns
-- (absence_deductions, adjustment_*, tips_amount).

-- CreateEnum
CREATE TYPE "PayrollAdjustmentType" AS ENUM ('BONUS', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "TipPoolStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "cash_registers" ADD COLUMN     "tips_collected" DECIMAL(14,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tip_amount" DECIMAL(14,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll_periods" ADD COLUMN     "absence_deductions" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "adjustment_bonuses" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "adjustment_deductions" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "tips_amount" DECIMAL(14,0) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shift_reports" ADD COLUMN     "tips_collected" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "employee_schedule_slots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "type" "PayrollAdjustmentType" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "source_kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_pools" (
    "id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "total_collected" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "total_distributed" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "status" "TipPoolStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tip_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_allocations" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "attended_days" INTEGER NOT NULL DEFAULT 0,
    "base_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "override_amount" DECIMAL(14,0),
    "final_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tip_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_schedule_slots_user_id_idx" ON "employee_schedule_slots"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_schedule_slots_user_id_day_of_week_key" ON "employee_schedule_slots"("user_id", "day_of_week");

-- CreateIndex
CREATE INDEX "payroll_adjustments_payroll_period_id_idx" ON "payroll_adjustments"("payroll_period_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_created_by_user_id_idx" ON "payroll_adjustments"("created_by_user_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_source_kind_source_id_idx" ON "payroll_adjustments"("source_kind", "source_id");

-- CreateIndex
CREATE INDEX "tip_pools_status_idx" ON "tip_pools"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tip_pools_week_start_key" ON "tip_pools"("week_start");

-- CreateIndex
CREATE INDEX "tip_allocations_user_id_idx" ON "tip_allocations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tip_allocations_pool_id_user_id_key" ON "tip_allocations"("pool_id", "user_id");

-- CreateIndex
CREATE INDEX "payments_tip_amount_idx" ON "payments"("tip_amount");

-- AddForeignKey
ALTER TABLE "employee_schedule_slots" ADD CONSTRAINT "employee_schedule_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_pools" ADD CONSTRAINT "tip_pools_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_allocations" ADD CONSTRAINT "tip_allocations_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "tip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_allocations" ADD CONSTRAINT "tip_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill payroll_periods decomposition for rows that pre-date this migration:
-- treat the old `deductions` as entirely absence-driven and the old `bonuses`
-- as entirely manual. Net pay is already correct because the formula
-- (gross - deductions - tab_deductions + bonuses) produces the same result.
UPDATE "payroll_periods"
SET "absence_deductions" = "deductions",
    "adjustment_bonuses"  = "bonuses"
WHERE "absence_deductions" = 0
  AND "adjustment_bonuses"  = 0;
