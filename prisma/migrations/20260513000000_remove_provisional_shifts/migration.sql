-- Remove provisional-shift workflow.
--
-- The provisional/regular split, parent-shift hierarchy, manager
-- verification, and the UNVERIFIED_PROVISIONAL alert type are all dropped.
-- The reports stack (shift_reports, daily_reports, alerts) stays — only the
-- provisional-specific columns are removed from those tables.

-- Drop any leftover unverified-provisional alerts before we remove the enum
-- value (Postgres can't change enum membership while rows reference it).
DELETE FROM "alerts" WHERE "type" = 'UNVERIFIED_PROVISIONAL';

-- DropForeignKey: parent_shift hierarchy + verifier
ALTER TABLE "cash_registers" DROP CONSTRAINT IF EXISTS "cash_registers_parent_shift_id_fkey";
ALTER TABLE "cash_registers" DROP CONSTRAINT IF EXISTS "cash_registers_verified_by_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "cash_registers_kind_idx";
DROP INDEX IF EXISTS "cash_registers_type_idx";
DROP INDEX IF EXISTS "cash_registers_parent_shift_id_idx";

-- DropColumns from cash_registers
ALTER TABLE "cash_registers"
  DROP COLUMN IF EXISTS "kind",
  DROP COLUMN IF EXISTS "type",
  DROP COLUMN IF EXISTS "parent_shift_id",
  DROP COLUMN IF EXISTS "requires_verification",
  DROP COLUMN IF EXISTS "verified_by_id",
  DROP COLUMN IF EXISTS "verified_at",
  DROP COLUMN IF EXISTS "verification_notes";

-- DropColumns from shift_reports
ALTER TABLE "shift_reports"
  DROP COLUMN IF EXISTS "shift_type",
  DROP COLUMN IF EXISTS "verified_by_id",
  DROP COLUMN IF EXISTS "verified_by_name",
  DROP COLUMN IF EXISTS "verified_at";

-- DropColumns from daily_reports
ALTER TABLE "daily_reports"
  DROP COLUMN IF EXISTS "provisional_shifts",
  DROP COLUMN IF EXISTS "unverified_provisionals";

-- Re-create the AlertType enum without UNVERIFIED_PROVISIONAL. Postgres
-- doesn't support removing an enum value directly, so we swap the type.
ALTER TYPE "AlertType" RENAME TO "AlertType_old";
CREATE TYPE "AlertType" AS ENUM (
  'CASH_SHORTAGE',
  'CASH_SURPLUS',
  'RECURRING_SHORTAGE',
  'EXCESSIVE_VOIDS',
  'EXCESSIVE_DISCOUNTS',
  'LATE_VOID'
);
ALTER TABLE "alerts" ALTER COLUMN "type" TYPE "AlertType" USING "type"::text::"AlertType";
DROP TYPE "AlertType_old";

-- Drop the now-unused enums
DROP TYPE IF EXISTS "ShiftType";
DROP TYPE IF EXISTS "CashRegisterKind";
