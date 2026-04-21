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

  // `low_only` needs a column-vs-column comparison (`quantity <= min_stock`)
  // that Prisma's findMany where clause can't express. Filtering in app code
  // *after* pagination would return partial pages, so instead we resolve the
  // matching ids via raw SQL and hand those off to Prisma.
  let idFilter: Prisma.StorageStockWhereInput = {};
  if (query.low_only) {
    const lowRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM storage_stocks
      WHERE storage_id = ${storageId}::uuid
        AND min_stock IS NOT NULL
        AND quantity <= min_stock
    `;
    idFilter = { id: { in: lowRows.map((r) => r.id) } };
    if (lowRows.length === 0) {
      // Avoid querying for `id IN ()` which Prisma treats as always-match on
      // some drivers; short-circuit with an empty page.
      return { items: [], nextCursor: null };
    }
  }

  const rows = await prisma.storageStock.findMany({
    where: { storage_id: storageId, ...idFilter },
    include: { supply: { select: { id: true, name: true, base_unit: true, active: true } } },
    orderBy: { id: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
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
