-- Phase 10b — Visual floor-plan layout. Tables gain pixel-space position,
-- size, shape, rotation, and an optional display label so the terminal can
-- render a drag-to-edit canvas instead of the old auto-flow grid. A new
-- ZoneLabel table holds free-floating text rendered on the same canvas
-- (room names, wall markers, decorative hints).

CREATE TYPE "TableShape" AS ENUM ('TABLE_RECT', 'TABLE_CIRCLE');

ALTER TABLE "tables"
    ADD COLUMN "pos_x"    INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN "pos_y"    INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN "width"    INTEGER     NOT NULL DEFAULT 120,
    ADD COLUMN "height"   INTEGER     NOT NULL DEFAULT 120,
    ADD COLUMN "shape"    "TableShape" NOT NULL DEFAULT 'TABLE_RECT',
    ADD COLUMN "label"    TEXT,
    ADD COLUMN "rotation" INTEGER     NOT NULL DEFAULT 0;

CREATE TABLE "zone_labels" (
    "id"         UUID        NOT NULL,
    "zone_id"    UUID        NOT NULL,
    "text"       TEXT        NOT NULL,
    "pos_x"      INTEGER     NOT NULL DEFAULT 0,
    "pos_y"      INTEGER     NOT NULL DEFAULT 0,
    "width"      INTEGER     NOT NULL DEFAULT 200,
    "height"     INTEGER     NOT NULL DEFAULT 48,
    "font_size"  INTEGER     NOT NULL DEFAULT 24,
    "rotation"   INTEGER     NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zone_labels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zone_labels_zone_id_idx" ON "zone_labels"("zone_id");

ALTER TABLE "zone_labels"
    ADD CONSTRAINT "zone_labels_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "zones"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed sensible defaults for any tables that existed before this migration so
-- they don't all stack at (0,0). Arrange each zone's tables in a 5-column
-- grid with 150px cells, anchored at (40, 120) — gives a workable starting
-- canvas that the user can then drag to match their actual floor.
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY zone_id ORDER BY number) - 1 AS idx
    FROM   "tables"
)
UPDATE "tables" t
SET    pos_x = 40  + ((o.idx %  5) * 150),
       pos_y = 120 + ((o.idx /  5) * 150)
FROM   ordered o
WHERE  t.id = o.id;
