import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateStorageInput,
  UpdateStorageInput,
  ListStorageQuery,
  StorageStockQuery,
  UpdateStorageStockInput,
} from './schema.js';

export async function createStorage(input: CreateStorageInput) {
  return prisma.storage.create({ data: input });
}

export async function listStorages(query: ListStorageQuery) {
  const where: Prisma.StorageWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const rows = await prisma.storage.findMany({
    where,
    orderBy: { name: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getStorage(id: string) {
  const row = await prisma.storage.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('Storage');
  return row;
}

export async function updateStorage(id: string, input: UpdateStorageInput) {
  await getStorage(id);
  return prisma.storage.update({ where: { id }, data: input });
}

export async function deleteStorage(id: string) {
  await getStorage(id);
  return prisma.storage.update({ where: { id }, data: { active: false } });
}

export async function listStorageStocks(storageId: string, query: StorageStockQuery) {
  await getStorage(storageId);
  // Prisma cannot express "quantity <= min_stock" directly in findMany, so when
  // the caller asks for low-stock rows we filter in app code (the set is small
  // per storage and we still respect the cursor).
  const rows = await prisma.storageStock.findMany({
    where: { storage_id: storageId },
    include: { supply: { select: { id: true, name: true, base_unit: true, active: true } } },
    orderBy: { id: 'asc' },
    ...buildCursorArgs(query),
  });
  const filtered = query.low_only
    ? rows.filter((r) => r.min_stock !== null && r.quantity.lessThanOrEqualTo(r.min_stock))
    : rows;
  return toPageResult(filtered, query.limit);
}

export async function updateStorageStock(
  storageId: string,
  supplyId: string,
  input: UpdateStorageStockInput,
) {
  const stock = await prisma.storageStock.findUnique({
    where: { supply_id_storage_id: { supply_id: supplyId, storage_id: storageId } },
  });
  if (!stock) throw new NotFoundError('StorageStock');
  return prisma.storageStock.update({
    where: { id: stock.id },
    data: { min_stock: input.min_stock ?? null },
  });
}
