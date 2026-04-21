import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateSupplyInput,
  UpdateSupplyInput,
  ListSupplyQuery,
  SupplyStockQuery,
} from './schema.js';

async function assertCategoryExists(categoryId: string): Promise<void> {
  const exists = await prisma.supplyCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('category_id references a non-existent category');
}

export async function createSupply(input: CreateSupplyInput) {
  await assertCategoryExists(input.category_id);
  return prisma.supply.create({ data: input });
}

export async function listSupplies(query: ListSupplyQuery) {
  const where: Prisma.SupplyWhereInput = {
    ...(query.include_deleted ? {} : { deleted_at: null }),
    ...(query.category_id ? { category_id: query.category_id } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.supply.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { category: true, tare_weight: true },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getSupply(id: string, includeDeleted = false) {
  const row = await prisma.supply.findUnique({
    where: { id },
    include: { category: true, tare_weight: true },
  });
  if (!row) throw new NotFoundError('Supply');
  if (!includeDeleted && row.deleted_at !== null) throw new NotFoundError('Supply');
  return row;
}

export async function updateSupply(id: string, input: UpdateSupplyInput) {
  const existing = await getSupply(id);
  if (input.category_id && input.category_id !== existing.category_id) {
    await assertCategoryExists(input.category_id);
  }
  return prisma.supply.update({
    where: { id },
    data: input,
    include: { category: true, tare_weight: true },
  });
}

export async function softDeleteSupply(id: string) {
  await getSupply(id);
  return prisma.supply.update({
    where: { id },
    data: { deleted_at: new Date(), active: false },
  });
}

export async function listSupplyStocks(supplyId: string, query: SupplyStockQuery) {
  await getSupply(supplyId);
  const rows = await prisma.storageStock.findMany({
    where: { supply_id: supplyId },
    include: { storage: { select: { id: true, name: true, active: true } } },
    orderBy: { id: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}
