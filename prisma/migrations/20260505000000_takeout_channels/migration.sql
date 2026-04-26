-- Sub-channel for TAKEOUT orders.
CREATE TYPE "TakeoutChannel" AS ENUM ('LOCAL', 'DELIVERY_LOCAL', 'DELIVERY_APP');

ALTER TABLE "orders"
  ADD COLUMN "takeout_channel" "TakeoutChannel";

-- Per-channel active flag stored in the existing key/value settings table.
-- All three channels default to enabled; the operator can flip them off in
-- the admin settings page.
INSERT INTO "settings" ("id", "key", "value", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'takeout_channel_local_active',          'true', NOW(), NOW()),
  (gen_random_uuid(), 'takeout_channel_delivery_local_active', 'true', NOW(), NOW()),
  (gen_random_uuid(), 'takeout_channel_delivery_app_active',   'true', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Singleton TAKEOUT zone — created here so users never need to set it up
-- manually and can't accidentally create a duplicate. The partial unique
-- index from the previous migration backstops this against future drift.
INSERT INTO "zones" ("id", "name", "display_order", "kind", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), 'Barra/takeout', 99, 'TAKEOUT', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "zones" WHERE "kind" = 'TAKEOUT' AND "active" = true
);
