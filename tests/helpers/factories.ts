import type { BaseUnit, ContentUnit, UserRole } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';

let counter = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++counter}`;

export async function makeUser(overrides: Partial<{ role: UserRole; email: string; name: string; pin: string }> = {}) {
  return prisma.user.create({
    data: {
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? `${uniq('user')}@test.local`,
      pin: overrides.pin ?? '1234',
      password_hash: 'not-a-real-hash',
      role: overrides.role ?? 'ADMIN',
    },
  });
}

export async function makeSupplier(overrides: Partial<{ name: string }> = {}) {
  return prisma.supplier.create({
    data: { name: overrides.name ?? uniq('Supplier') },
  });
}

export async function makeSupplyCategory(overrides: Partial<{ name: string }> = {}) {
  return prisma.supplyCategory.create({
    data: { name: overrides.name ?? uniq('Category') },
  });
}

export async function makeStorage(overrides: Partial<{ name: string }> = {}) {
  return prisma.storage.create({
    data: { name: overrides.name ?? uniq('Storage') },
  });
}

export async function makeSupply(overrides: {
  category_id?: string;
  name?: string;
  base_unit?: BaseUnit;
  content_per_unit?: number;
  content_unit?: ContentUnit;
} = {}) {
  const categoryId = overrides.category_id ?? (await makeSupplyCategory()).id;
  return prisma.supply.create({
    data: {
      name: overrides.name ?? uniq('Supply'),
      category_id: categoryId,
      base_unit: overrides.base_unit ?? 'BOTTLE',
      content_per_unit: overrides.content_per_unit,
      content_unit: overrides.content_unit,
    },
  });
}

export async function makePackaging(overrides: {
  supply_id: string;
  supplier_id: string;
  name?: string;
  units_per_package?: number;
}) {
  return prisma.purchasePackaging.create({
    data: {
      supply_id: overrides.supply_id,
      supplier_id: overrides.supplier_id,
      name: overrides.name ?? uniq('Pack'),
      units_per_package: overrides.units_per_package ?? 1,
    },
  });
}

// Seed stock without going through a purchase — useful for tests that assert
// behavior of transfers, write-offs, and inventory adjustments in isolation.
export async function seedStock(overrides: {
  supply_id: string;
  storage_id: string;
  quantity: number;
  min_stock?: number;
  average_cost?: number;
}) {
  await prisma.storageStock.upsert({
    where: {
      supply_id_storage_id: {
        supply_id: overrides.supply_id,
        storage_id: overrides.storage_id,
      },
    },
    create: {
      supply_id: overrides.supply_id,
      storage_id: overrides.storage_id,
      quantity: overrides.quantity,
      min_stock: overrides.min_stock ?? null,
    },
    update: {
      quantity: overrides.quantity,
      min_stock: overrides.min_stock ?? null,
    },
  });
  if (overrides.average_cost !== undefined) {
    await prisma.supply.update({
      where: { id: overrides.supply_id },
      data: {
        average_cost: overrides.average_cost,
        last_cost: overrides.average_cost,
      },
    });
  }
}
