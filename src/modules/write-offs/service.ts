import { Prisma, StockMovementType, WriteOffReason } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type {
  CreateWriteOffBatchInput,
  CreateWriteOffInput,
  ListWriteOffQuery,
} from './schema.js';

const writeOffInclude = {
  supply: { select: { id: true, name: true, base_unit: true } },
  storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.WriteOffInclude;

type Tx = Prisma.TransactionClient;

interface ApplyWriteOffLine {
  storage_id: string;
  supply_id: string;
  quantity: number | Decimal | string;
  reason: WriteOffReason;
  notes?: string;
  date: Date;
}

/**
 * Core per-line write-off mutation: validates storage + supply, decrements
 * StorageStock, writes the WriteOff row, and logs a WRITE_OFF StockMovement.
 * Always runs inside the caller's transaction so single + batch paths share
 * the same invariants. Returns the WriteOff id so the caller can re-fetch
 * with the include shape it needs.
 */
async function applyWriteOffWithinTx(
  tx: Tx,
  userId: string,
  line: ApplyWriteOffLine,
): Promise<string> {
  const [storage, supply] = await Promise.all([
    tx.storage.findUnique({
      where: { id: line.storage_id },
      select: { id: true, active: true },
    }),
    tx.supply.findFirst({
      where: { id: line.supply_id, deleted_at: null },
      select: { id: true, average_cost: true },
    }),
  ]);
  if (!storage) throw new BadRequestError('storage_id references a non-existent storage');
  if (!storage.active) throw new BadRequestError('storage is inactive');
  if (!supply) throw new BadRequestError('supply_id references a non-existent supply');

  const qty = new Decimal(line.quantity);

  const stock = await tx.storageStock.findUnique({
    where: {
      supply_id_storage_id: {
        supply_id: line.supply_id,
        storage_id: line.storage_id,
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
      storage_id: line.storage_id,
      supply_id: line.supply_id,
      quantity: qty,
      reason: line.reason,
      notes: line.notes,
      date: line.date,
      user_id: userId,
    },
  });

  await tx.storageStock.update({
    where: {
      supply_id_storage_id: {
        supply_id: line.supply_id,
        storage_id: line.storage_id,
      },
    },
    data: { quantity: { decrement: qty } },
  });

  await tx.stockMovement.create({
    data: {
      supply_id: line.supply_id,
      storage_id: line.storage_id,
      type: StockMovementType.WRITE_OFF,
      quantity: qty.neg(),
      reference_type: 'WriteOff',
      reference_id: writeOff.id,
      unit_cost: supply.average_cost,
    },
  });

  return writeOff.id;
}

/**
 * Manual write-off: decrement StorageStock and log a WRITE_OFF movement.
 * Rejects if the source storage doesn't have enough stock — write-offs are
 * an inventory correction, not a license to drive stock negative.
 */
export async function createWriteOff(userId: string, input: CreateWriteOffInput) {
  return prisma.$transaction(async (tx) => {
    const id = await applyWriteOffWithinTx(tx, userId, input);
    return tx.writeOff.findUniqueOrThrow({
      where: { id },
      include: writeOffInclude,
    });
  });
}

/**
 * Multi-line write-off ticket: every line succeeds or none do. Lets the
 * terminal record a botched-drink event (espresso + syrup wasted, milk kept)
 * as a single atomic event instead of N round-trips.
 */
export async function createWriteOffBatch(
  userId: string,
  input: CreateWriteOffBatchInput,
) {
  return prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const item of input.items) {
      const id = await applyWriteOffWithinTx(tx, userId, {
        storage_id: input.storage_id,
        supply_id: item.supply_id,
        quantity: item.quantity,
        reason: item.reason ?? input.reason,
        notes: item.notes ?? input.notes,
        date: input.date,
      });
      ids.push(id);
    }
    return tx.writeOff.findMany({
      where: { id: { in: ids } },
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
