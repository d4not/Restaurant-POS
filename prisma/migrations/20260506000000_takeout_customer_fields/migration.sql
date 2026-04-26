-- Optional customer/delivery snapshots for takeout orders. All nullable so
-- DINE_IN rows stay untouched and the cashier can fill them in piecemeal as
-- the order progresses (a delivery customer may give the address up front
-- but the driver assignment lands minutes later).
ALTER TABLE "orders"
  ADD COLUMN "customer_name"         TEXT,
  ADD COLUMN "customer_phone"        TEXT,
  ADD COLUMN "delivery_address"      TEXT,
  ADD COLUMN "delivery_reference"    TEXT,
  ADD COLUMN "delivery_driver_name"  TEXT,
  ADD COLUMN "delivery_app"          TEXT,
  ADD COLUMN "delivery_app_order_id" TEXT;
