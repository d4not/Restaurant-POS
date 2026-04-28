-- Daily report print refactor (REPORTS-SPEC §5).
--
-- Adds the four columns the verification-checklist printout needs:
--   * currency / language — snapshotted from settings at close time so an
--     old report keeps its labels even if the active language changes.
--   * denomination_breakdown — bills/coins counted by the manager, JSON
--     map of {centavos: count}. Optional; the printout falls back to the
--     reconciliation formula when null.
--   * resolution — the manager's final verdict on the cash count, separate
--     from operational notes.
--
-- Also seeds the new `currency` setting (MXN by default) so the close
-- service has something to snapshot on day one.

ALTER TABLE "daily_reports"
  ADD COLUMN "currency"               TEXT      NOT NULL DEFAULT 'MXN',
  ADD COLUMN "language"               TEXT      NOT NULL DEFAULT 'es',
  ADD COLUMN "denomination_breakdown" JSONB,
  ADD COLUMN "resolution"             TEXT;

INSERT INTO "settings" (id, key, value, created_at, updated_at) VALUES
  (gen_random_uuid(), 'currency', 'MXN', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
