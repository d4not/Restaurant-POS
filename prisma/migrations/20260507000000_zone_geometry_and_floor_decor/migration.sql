-- Zone geometry on the floor canvas — zones are now rendered as dashed-bordered
-- boxes at these coordinates. Defaults give every zone a 480x320 footprint at
-- the origin; the seeding query below spreads existing zones out into a row so
-- the canvas isn't a stack of overlapping boxes after migrate.
ALTER TABLE "zones"
    ADD COLUMN "pos_x"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "pos_y"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "width"  INTEGER NOT NULL DEFAULT 480,
    ADD COLUMN "height" INTEGER NOT NULL DEFAULT 320;

-- Spread existing DINE_IN zones in a row, ordered by display_order then name.
-- 510px stride (480 width + 30 gap), starting at (30, 30). TAKEOUT zones never
-- render on the canvas so their geometry doesn't matter — leave them at 0,0.
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY display_order, name) - 1 AS idx
    FROM   "zones"
    WHERE  "kind" = 'DINE_IN'
)
UPDATE "zones" z
SET    pos_x = 30 + (o.idx * 510),
       pos_y = 30
FROM   ordered o
WHERE  z.id = o.id;

-- Decorative non-table elements painted on the floor canvas. Each is scoped to
-- a zone (cascade deletes when the zone is wiped) and lives or dies by `active`
-- like everything else in the floor module.
CREATE TYPE "DecorType" AS ENUM ('BAR_COUNTER', 'DECOR_PLANT');

CREATE TABLE "floor_decor" (
    "id"         UUID         NOT NULL,
    "zone_id"    UUID         NOT NULL,
    "type"       "DecorType"  NOT NULL,
    "pos_x"      INTEGER      NOT NULL DEFAULT 0,
    "pos_y"      INTEGER      NOT NULL DEFAULT 0,
    "width"      INTEGER      NOT NULL DEFAULT 80,
    "height"     INTEGER      NOT NULL DEFAULT 50,
    "label"      TEXT,
    "rotation"   INTEGER      NOT NULL DEFAULT 0,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_decor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "floor_decor_zone_id_idx" ON "floor_decor"("zone_id");

ALTER TABLE "floor_decor"
    ADD CONSTRAINT "floor_decor_zone_id_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "zones"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
