import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreatePackagingInput,
  UpdatePackagingInput,
  ListPackagingQuery,
} from './schema.js';

async function assertRefs(
  client: Prisma.TransactionClient | typeof prisma,
  supplyId: string,
  supplierId: string,
): Promise<void> {
  const [supply, supplier] = await Promise.all([
    client.supply.findFirst({
      where: { id: supplyId, deleted_at: null },
      select: { id: true },
    }),
    client.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, active: true },
    }),
  ]);
  if (!supply) throw new BadRequestError('supply_id references a non-existent supply');
  if (!supplier) throw new BadRequestError('supplier_id references a non-existent supplier');
  if (!supplier.active) throw new BadRequestError('supplier is inactive');
}

// At most one packaging per supply may be flagged is_primary=true. Whenever a
// caller asks to set the flag on one row we atomically clear it on every other
// packaging for the same supply — enforcing the invariant inside the same
// transaction avoids a race where two concurrent writes both end up primary.
async function clearOtherPrimaries(
  tx: Prisma.TransactionClient,
  supplyId: string,
  keepId: string | null,
): Promise<void> {
  await tx.purchasePackaging.updateMany({
    where: {
      supply_id: supplyId,
      is_primary: true,
      ...(keepId ? { NOT: { id: keepId } } : {}),
    },
    data: { is_primary: false },
  });
}

export async function createPackaging(input: CreatePackagingInput) {
  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, input.supply_id, input.supplier_id);
    const created = await tx.purchasePackaging.create({ data: input });
    if (input.is_primary) {
      await clearOtherPrimaries(tx, input.supply_id, created.id);
    }
    return created;
  });
}

export async function listPackagings(query: ListPackagingQuery) {
  const where: Prisma.PurchasePackagingWhereInput = {
    ...(query.supply_id ? { supply_id: query.supply_id } : {}),
    ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  const rows = await prisma.purchasePackaging.findMany({
    where,
    orderBy: [{ is_primary: 'desc' }, { supply_id: 'asc' }, { name: 'asc' }],
    include: {
      supplier: { select: { id: true, name: true } },
    },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getPackaging(id: string) {
  const row = await prisma.purchasePackaging.findUnique({
    where: { id },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (!row) throw new NotFoundError('PurchasePackaging');
  return row;
}

export async function updatePackaging(id: string, input: UpdatePackagingInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchasePackaging.findUnique({
      where: { id },
      select: { id: true, supply_id: true },
    });
    if (!existing) throw new NotFoundError('PurchasePackaging');
    const updated = await tx.purchasePackaging.update({
      where: { id },
      data: input,
      include: { supplier: { select: { id: true, name: true } } },
    });
    if (input.is_primary) {
      await clearOtherPrimaries(tx, existing.supply_id, id);
    }
    return updated;
  });
}

export async function deletePackaging(id: string) {
  await getPackaging(id);
  // Soft-delete: packagings may be referenced by historical PurchaseItems.
  return prisma.purchasePackaging.update({
    where: { id },
    data: { active: false, is_primary: false },
  });
}
