import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateSupplyCategoryInput,
  UpdateSupplyCategoryInput,
  ListSupplyCategoryQuery,
} from './schema.js';

export async function createSupplyCategory(input: CreateSupplyCategoryInput) {
  return prisma.supplyCategory.create({ data: input });
}

export async function listSupplyCategories(query: ListSupplyCategoryQuery) {
  const where: Prisma.SupplyCategoryWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};
  const rows = await prisma.supplyCategory.findMany({
    where,
    orderBy: { name: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getSupplyCategory(id: string) {
  const row = await prisma.supplyCategory.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('SupplyCategory');
  return row;
}

export async function updateSupplyCategory(id: string, input: UpdateSupplyCategoryInput) {
  await getSupplyCategory(id);
  return prisma.supplyCategory.update({ where: { id }, data: input });
}

export async function deleteSupplyCategory(id: string) {
  // Run the existence check, occupancy count, and delete in one transaction so
  // a concurrent Supply insert cannot sneak in between the count and delete.
  return prisma.$transaction(async (tx) => {
    const row = await tx.supplyCategory.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundError('SupplyCategory');
    const supplyCount = await tx.supply.count({ where: { category_id: id, deleted_at: null } });
    if (supplyCount > 0) {
      throw new ConflictError('Cannot delete category with active supplies');
    }
    await tx.supplyCategory.delete({ where: { id } });
  });
}
