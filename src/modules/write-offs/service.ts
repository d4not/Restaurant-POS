import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type { CreateWriteOffInput, ListWriteOffQuery } from './schema.js';

const writeOffInclude = {
  supply: { select: { id: true, name: true, base_unit: true } },
  storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.WriteOffInclude;

/**
 * Manual write-off: decrement StorageStock and log a WRITE_OFF movement.
 * Rejects if the source storage doesn't have enough stock — write-offs are
 * an inventory correction, not a license to drive stock negative.
 */
export async function createWriteOff(userId: string, input: CreateWriteOffInput) {
  return prisma.$transaction(async (tx) => {
    const [storage, supply] = await Promise.all([
      tx.storage.findUnique({ where: { id: input.storage_id }, select: { id: true } }),
      tx.supply.findFirst({
        where: { id: input.supply_id, deleted_at: null },
        select: { id: true, average_cost: true },
      }),
    ]);
    if (!storage) throw new BadRequestError('storage_id references a non-existent storage');
    if (!supply) throw new BadRequestError('supply_id references a non-existent supply');

    const qty = new Decimal(input.quantity);

    const stock = await tx.storageStock.findUnique({
      where: {
        supply_id_storage_id: {
          supply_id: input.supply_id,
          storage_id: input.storage_id,
        },
      },
      select: { quantity: true },
    });
    const available = new Decimal(stock?.quantity ?? 0);
    if (available.lessThan(qty)) {
      throw new ConflictError(
        `Insufficient stock for write-off: have ${available.toString()}, need ${qty.toString()}`,
      );
    }

    const writeOff = await tx.writeOff.create({
      data: {
        storage_id: input.storage_id,
        supply_id: input.supply_id,
        quantity: qty,
        reason: input.reason,
        notes: input.notes,
        date: input.date,
        user_id: userId,
      },
    });

    await tx.storageStock.update({
      where: {
        supply_id_storage_id: {
          supply_id: input.supply_id,
          storage_id: input.storage_id,
        },
      },
      data: { quantity: { decrement: qty } },
    });

    await tx.stockMovement.create({
      data: {
        supply_id: input.supply_id,
        storage_id: input.storage_id,
        type: StockMovementType.WRITE_OFF,
        quantity: qty.neg(),
        reference_type: 'WriteOff',
        reference_id: writeOff.id,
        unit_cost: supply.average_cost,
      },
    });

    return tx.writeOff.findUniqueOrThrow({
      where: { id: writeOff.id },
      include: writeOffInclude,
    });
  });
}

export async function listWriteOffs(query: ListWriteOffQuery) {
  const where: Prisma.WriteOffWhereInput = {
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.supply_id ? { supply_id: query.supply_id } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.writeOff.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: writeOffInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getWriteOff(id: string) {
  const row = await prisma.writeOff.findUnique({
    where: { id },
    include: writeOffInclude,
  });
  if (!row) throw new NotFoundError('WriteOff');
  return row;
}
