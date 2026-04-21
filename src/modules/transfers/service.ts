import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type { CreateTransferInput, ListTransferQuery } from './schema.js';

const transferInclude = {
  items: { include: { supply: { select: { id: true, name: true, base_unit: true } } } },
  from_storage: { select: { id: true, name: true } },
  to_storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.TransferInclude;

async function loadTransferOrThrow(client: Prisma.TransactionClient | typeof prisma, id: string) {
  const row = await client.transfer.findUnique({ where: { id }, include: transferInclude });
  if (!row) throw new NotFoundError('Transfer');
  return row;
}

/**
 * Creates a transfer between two storages and applies stock movement atomically.
 *
 * Validates each line against current source stock BEFORE any mutation — partial
 * transfers are not allowed because reversing half a multi-line transfer mid-
 * flight would leave the audit log inconsistent.
 */
export async function createTransfer(userId: string, input: CreateTransferInput) {
  return prisma.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.storage.findUnique({
        where: { id: input.from_storage_id },
        select: { id: true, active: true },
      }),
      tx.storage.findUnique({
        where: { id: input.to_storage_id },
        select: { id: true, active: true },
      }),
    ]);
    if (!from) throw new BadRequestError('from_storage_id references a non-existent storage');
    if (!from.active) throw new BadRequestError('from_storage is inactive');
    if (!to) throw new BadRequestError('to_storage_id references a non-existent storage');
    if (!to.active) throw new BadRequestError('to_storage is inactive');

    // Aggregate duplicate supply_id lines so the per-supply stock check below
    // reflects the true requested draw rather than each line in isolation.
    const aggregated = new Map<string, Decimal>();
    for (const item of input.items) {
      const qty = new Decimal(item.quantity);
      aggregated.set(item.supply_id, (aggregated.get(item.supply_id) ?? new Decimal(0)).add(qty));
    }

    for (const [supplyId, totalQty] of aggregated) {
      const supply = await tx.supply.findFirst({
        where: { id: supplyId, deleted_at: null },
        select: { id: true, average_cost: true },
      });
      if (!supply) {
        throw new BadRequestError(`supply ${supplyId} not found`);
      }

      const sourceStock = await tx.storageStock.findUnique({
        where: {
          supply_id_storage_id: { supply_id: supplyId, storage_id: input.from_storage_id },
        },
        select: { quantity: true },
      });
      const available = new Decimal(sourceStock?.quantity ?? 0);
      if (available.lessThan(totalQty)) {
        throw new ConflictError(
          `Insufficient stock for supply ${supplyId} at source: have ${available.toString()}, need ${totalQty.toString()}`,
        );
      }
    }

    const transfer = await tx.transfer.create({
      data: {
        from_storage_id: input.from_storage_id,
        to_storage_id: input.to_storage_id,
        date: input.date,
        notes: input.notes,
        user_id: userId,
        items: {
          create: input.items.map((it) => ({
            supply_id: it.supply_id,
            quantity: new Decimal(it.quantity),
          })),
        },
      },
    });

    for (const item of input.items) {
      const qty = new Decimal(item.quantity);
      const supply = await tx.supply.findUniqueOrThrow({
        where: { id: item.supply_id },
        select: { average_cost: true },
      });

      // Atomic conditional decrement: only succeed if the row still has
      // enough stock at apply-time. Two concurrent transfers drawing from
      // the same (supply, storage) would both pass the upfront pre-check
      // above because SELECT doesn't hold a row lock — this guard catches
      // the loser and rolls the whole transaction back.
      const decremented = await tx.$executeRaw`
        UPDATE storage_stocks
           SET quantity   = quantity - ${qty}::numeric,
               updated_at = now()
         WHERE supply_id  = ${item.supply_id}::uuid
           AND storage_id = ${input.from_storage_id}::uuid
           AND quantity  >= ${qty}::numeric
      `;
      if (decremented === 0) {
        throw new ConflictError(
          `Insufficient stock for supply ${item.supply_id} at source (concurrent draw)`,
        );
      }

      await tx.storageStock.upsert({
        where: {
          supply_id_storage_id: {
            supply_id: item.supply_id,
            storage_id: input.to_storage_id,
          },
        },
        create: {
          supply_id: item.supply_id,
          storage_id: input.to_storage_id,
          quantity: qty,
        },
        update: { quantity: { increment: qty } },
      });

      await tx.stockMovement.createMany({
        data: [
          {
            supply_id: item.supply_id,
            storage_id: input.from_storage_id,
            type: StockMovementType.TRANSFER_OUT,
            quantity: qty.neg(),
            reference_type: 'Transfer',
            reference_id: transfer.id,
            unit_cost: supply.average_cost,
          },
          {
            supply_id: item.supply_id,
            storage_id: input.to_storage_id,
            type: StockMovementType.TRANSFER_IN,
            quantity: qty,
            reference_type: 'Transfer',
            reference_id: transfer.id,
            unit_cost: supply.average_cost,
          },
        ],
      });
    }

    return loadTransferOrThrow(tx, transfer.id);
  });
}

export async function listTransfers(query: ListTransferQuery) {
  const where: Prisma.TransferWhereInput = {
    ...(query.from_storage_id ? { from_storage_id: query.from_storage_id } : {}),
    ...(query.to_storage_id ? { to_storage_id: query.to_storage_id } : {}),
    ...(query.supply_id ? { items: { some: { supply_id: query.supply_id } } } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.transfer.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: transferInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getTransfer(id: string) {
  return loadTransferOrThrow(prisma, id);
}
