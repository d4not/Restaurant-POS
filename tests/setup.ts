import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

// Preserving the order: child tables before parents is unnecessary because we
// use TRUNCATE ... CASCADE, but listing explicit tables keeps us safe from
// clearing out `_prisma_migrations`.
const TRUNCATE_TABLES = [
  'users',
  'taxes',
  'settings',
  'supply_categories',
  'supplies',
  'suppliers',
  'purchase_packagings',
  'storages',
  'storage_stocks',
  'tare_weights',
  'purchases',
  'purchase_items',
  'transfers',
  'transfer_items',
  'inventory_checks',
  'inventory_check_items',
  'write_offs',
  'stock_movements',
  'deduction_rules',
  'product_categories',
  'products',
  'product_variants',
  'modifier_groups',
  'modifiers',
  'product_modifier_groups',
  'recipes',
  'recipe_items',
  'product_modifications',
  'modifier_product_overrides',
  'cash_registers',
  'cash_movements',
  'orders',
  'order_items',
  'order_item_modifiers',
  'payments',
  'attendance',
  'payroll_periods',
  'tables',
  'zones',
  'shift_reports',
  'daily_reports',
  'alerts',
];
// Tables that are reached purely through CASCADE from the parents above:
//   employee_schedule_slots, tip_pools, tip_allocations    (← users)
//   payroll_adjustments                                    (← payroll_periods)
//   employee_products, employee_sales                      (← products, users)
// Listing them explicitly causes lock-ordering deadlocks during TRUNCATE
// CASCADE under the singleFork test runner, so we rely on the cascade chain.

// TRUNCATE ... CASCADE needs AccessExclusiveLock on every listed table and
// every table reached through CASCADE. With supertest, the HTTP response can
// resolve a tick before the Express middleware fully releases its DB
// connection, which leaves a RowShareLock dangling for a few ms and races
// our TRUNCATE under singleFork. The CASCADE chain now covers more tables
// (payroll_adjustments, employee_*, tip_*), making the lock surface larger
// and deadlocks more likely.
//
// Fix: serialize the truncate behind a session-level advisory lock so only
// one cleaner can be in flight at a time, then retry on the transient
// deadlock code with a backoff. The advisory lock has no semantic meaning
// in the production code — its only purpose is to make this beforeEach
// atomic with respect to itself across the lone fork's connection pool.
const TRUNCATE_LOCK_KEY = 1734567890;

async function truncateAllWithRetry(): Promise<void> {
  // Acquire the advisory lock on a dedicated connection — pg_advisory_lock
  // is session-scoped, and we want to release it explicitly below.
  await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(${TRUNCATE_LOCK_KEY});`);
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await prisma.$executeRawUnsafe(
          `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const transient =
          message.includes('deadlock') ||
          message.includes('40P01') ||
          message.includes('lock timeout');
        if (!transient || attempt === 7) throw err;
        await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
      }
    }
  } finally {
    // Best-effort release — if the advisory lock can't be released we leave
    // it for the connection's end-of-life cleanup, which is acceptable in
    // the test runtime since the fork dies once the suite finishes.
    try {
      await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${TRUNCATE_LOCK_KEY});`);
    } catch {
      // ignore
    }
  }
}

beforeEach(async () => {
  await truncateAllWithRetry();
});

afterAll(async () => {
  await prisma.$disconnect();
});
