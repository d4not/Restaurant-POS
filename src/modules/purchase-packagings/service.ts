import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreatePackagingInput,
  UpdatePackagingInput,
  ListPackagingQuery,
} from './schema.js';

async function assertRefs(supplyId: string, supplierId: string): Promise<void> {
  const [supply, supplier] = await Promise.all([
    prisma.supply.findFirst({ where: { id: supplyId, deleted_at: null }, select: { id: true } }),
    prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, active: true },
    }),
  ]);
  if (!supply) throw new BadRequestError('supply_id references a non-existent supply');
  if (!supplier) throw new BadRequestError('supplier_id references a non-existent supplier');
  if (!supplier.active) throw new BadRequestError('supplier is inactive');
}

export async function createPackaging(input: CreatePackagingInput) {
  await assertRefs(input.supply_id, input.supplier_id);
  return prisma.purchasePackaging.create({ data: input });
}

export async function listPackagings(query: ListPackagingQuery) {
  const where: Prisma.PurchasePackagingWhereInput = {
    ...(query.supply_id ? { supply_id: query.supply_id } : {}),
    ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  const rows = await prisma.purchasePackaging.findMany({
    where,
    orderBy: [{ supply_id: 'asc' }, { name: 'asc' }],
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getPackaging(id: string) {
  const row = await prisma.purchasePackaging.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('PurchasePackaging');
  return row;
}

export async function updatePackaging(id: string, input: UpdatePackagingInput) {
  await getPackaging(id);
  return prisma.purchasePackaging.update({ where: { id }, data: input });
}

export async function deletePackaging(id: string) {
  await getPackaging(id);
  // Soft-delete: packagings may be referenced by historical PurchaseItems.
  return prisma.purchasePackaging.update({ where: { id }, data: { active: false } });
}
