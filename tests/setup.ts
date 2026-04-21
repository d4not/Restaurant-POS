import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

// Preserving the order: child tables before parents is unnecessary because we
// use TRUNCATE ... CASCADE, but listing explicit tables keeps us safe from
// clearing out `_prisma_migrations`.
const TRUNCATE_TABLES = [
  'users',
  'taxes',
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
  'cash_registers',
  'cash_movements',
  'orders',
  'order_items',
  'order_item_modifiers',
  'payments',
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
