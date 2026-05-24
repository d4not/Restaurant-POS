-- Legacy CONFIRMED → VERIFIED remap. Split from the schema migration because
-- Postgres rejects (55P04) using a freshly-added enum value in the same
-- transaction. Now that 20260524100000_purchase_orders_redesign committed,
-- VERIFIED is safe to reference.
UPDATE "purchases"
  SET status      = 'VERIFIED',
      verified_at = COALESCE(verified_at, updated_at)
  WHERE status = 'CONFIRMED';
