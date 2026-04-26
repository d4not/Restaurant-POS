-- Zone.kind: DINE_IN (default, hosts tables) or TAKEOUT (virtual zone for the
-- takeout/delivery tab — never holds tables). At most one TAKEOUT zone is
-- allowed system-wide; the partial unique index enforces this without blocking
-- multiple inactive (soft-deleted) takeout zones from coexisting in history.
CREATE TYPE "ZoneKind" AS ENUM ('DINE_IN', 'TAKEOUT');

ALTER TABLE "zones"
  ADD COLUMN "kind" "ZoneKind" NOT NULL DEFAULT 'DINE_IN';

CREATE UNIQUE INDEX "zones_one_takeout_active"
  ON "zones" ("kind")
  WHERE "kind" = 'TAKEOUT' AND "active" = true;
