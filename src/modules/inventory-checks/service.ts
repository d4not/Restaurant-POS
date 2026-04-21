import {
  InventoryCheckStatus,
  InventoryCheckType,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type {
  CreateInventoryCheckInput,
  ListInventoryCheckQuery,
  SetCheckItemsInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const checkInclude = {
  items: { include: { supply: { select: { id: true, name: true, base_unit: true } } } },
  storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.InventoryCheckInclude;

async function loadCheckOrThrow(client: PrismaLike, id: string) {
  const row = await client.inventoryCheck.findUnique({
    where: { id },
    include: checkInclude,
  });
  if (!row) throw new NotFoundError('InventoryCheck');
  return row;
}

async function assertInProgress(client: PrismaLike, id: string): Promise<void> {
  const row = await client.inventoryCheck.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) throw new NotFoundError('InventoryCheck');
  if (row.status !== InventoryCheckStatus.IN_PROGRESS) {
    throw new ConflictError('InventoryCheck is already completed');
  }
}

/**
 * Create a new inventory check.
 * - FULL: seed items for every supply with a StorageStock row at this storage.
 * - PARTIAL: seed items only for the supplied supply_ids.
 *
 * Each seeded item captures the system's current stock as expected_qty. The
 * counter then fills actual_qty in a subsequent call and completes the check.
 */
export async function createInventoryCheck(
  userId: string,
  input: CreateInventoryCheckInput,
) {
  if (input.type === InventoryCheckType.PARTIAL) {
    if (!input.supply_ids || input.supply_ids.length === 0) {
      throw new BadRequestError('PARTIAL check requires supply_ids');
    }
  }

  return prisma.$transaction(async (tx) => {
    const storage = await tx.storage.findUnique({
      where: { id: input.storage_id },
      select: { id: true },
    });
    if (!storage) throw new BadRequestError('storage_id references a non-existent storage');

    // Build the seed set of supplies to count.
    const stockWhere: Prisma.StorageStockWhereInput = { storage_id: input.storage_id };
    if (input.type === InventoryCheckType.PARTIAL) {
      stockWhere.supply_id = { in: input.supply_ids! };
    }
    const existingStocks = await tx.storageStock.findMany({
      where: stockWhere,
      select: { supply_id: true, quantity: true },
    });
    const stockMap = new Map(existingStocks.map((s) => [s.supply_id, new Decimal(s.quantity)]));

    // For PARTIAL checks, include any requested supply that has no stock row
    // yet (expected_qty = 0). FULL checks only count supplies that already
    // have a storage-stock entry — i.e. ones the business tracks at all.
    let supplyIds: string[];
    if (input.type === InventoryCheckType.PARTIAL) {
      // Validate all requested supplies exist (and are not soft-deleted).
      const found = await tx.supply.findMany({
        where: { id: { in: input.supply_ids! }, deleted_at: null },
        select: { id: true },
      });
      if (found.length !== input.supply_ids!.length) {
        throw new BadRequestError('One or more supply_ids not found');
      }
      supplyIds = input.supply_ids!;
    } else {
      supplyIds = existingStocks.map((s) => s.supply_id);
    }

    const check = await tx.inventoryCheck.create({
      data: {
        storage_id: input.storage_id,
        type: input.type,
        date: input.date,
        user_id: userId,
        status: InventoryCheckStatus.IN_PROGRESS,
        items: {
          create: supplyIds.map((sid) => {
            const expected = stockMap.get(sid) ?? new Decimal(0);
            return {
              supply_id: sid,
              expected_qty: expected,
              actual_qty: expected,
              difference: new Decimal(0),
              difference_cost: new Decimal(0),
            };
          }),
        },
      },
    });

    return loadCheckOrThrow(tx, check.id);
  });
}

export async function listInventoryChecks(query: ListInventoryCheckQuery) {
  const where: Prisma.InventoryCheckWhereInput = {
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.inventoryCheck.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: checkInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getInventoryCheck(id: string) {
  return loadCheckOrThrow(prisma, id);
}

/**
 * Record the physically-counted quantities. Recomputes difference and
 * difference_cost (in centavos) against the supply's current average_cost.
 * Rows not mentioned in `items` keep their previous values.
 */
export async function setCheckItems(id: string, input: SetCheckItemsInput) {
  return prisma.$transaction(async (tx) => {
    await assertInProgress(tx, id);

    const existing = await tx.inventoryCheckItem.findMany({
      where: { check_id: id },
      select: { id: true, supply_id: true, expected_qty: true },
    });
    const existingBySupply = new Map(existing.map((e) => [e.supply_id, e]));

    for (const item of input.items) {
      const row = existingBySupply.get(item.supply_id);
      if (!row) {
        throw new BadRequestError(
          `supply ${item.supply_id} is not part of this inventory check`,
        );
      }
      const supply = await tx.supply.findUniqueOrThrow({
        where: { id: item.supply_id },
        select: { average_cost: true },
      });
      const actual = new Decimal(item.actual_qty);
      const expected = new Decimal(row.expected_qty);
      const difference = actual.sub(expected);
      const differenceCost = difference.mul(new Decimal(supply.average_cost));
      await tx.inventoryCheckItem.update({
        where: { id: row.id },
        data: {
          actual_qty: actual,
          difference,
          difference_cost: differenceCost,
        },
      });
    }

    return loadCheckOrThrow(tx, id);
  });
}

/**
 * Complete the check: for each item, set StorageStock.quantity = actual_qty
 * and log an ADJUSTMENT StockMovement whose quantity is the signed difference.
 * Items with difference == 0 still flip the stock deterministically but skip
 * the audit row (a zero-delta movement would just be noise).
 */
export async function completeInventoryCheck(id: string) {
  return prisma.$transaction(async (tx) => {
    await assertInProgress(tx, id);
    const check = await tx.inventoryCheck.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    for (const item of check.items) {
      const actual = new Decimal(item.actual_qty);
      const expected = new Decimal(item.expected_qty);
      const difference = actual.sub(expected);

      const supply = await tx.supply.findUniqueOrThrow({
        where: { id: item.supply_id },
        select: { average_cost: true },
      });

      // Force stock to the counted value even if no row exists yet (PARTIAL
      // check against a supply that was never stocked here before).
      await tx.storageStock.upsert({
        where: {
          supply_id_storage_id: {
            supply_id: item.supply_id,
            storage_id: check.storage_id,
          },
        },
        create: {
          supply_id: item.supply_id,
          storage_id: check.storage_id,
          quantity: actual,
        },
        update: { quantity: actual },
      });

      if (!difference.isZero()) {
        await tx.stockMovement.create({
          data: {
            supply_id: item.supply_id,
            storage_id: check.storage_id,
            type: StockMovementType.ADJUSTMENT,
            quantity: difference,
            reference_type: 'InventoryCheck',
            reference_id: check.id,
            unit_cost: supply.average_cost,
          },
        });
      }
    }

    await tx.inventoryCheck.update({
      where: { id },
      data: {
        status: InventoryCheckStatus.COMPLETED,
        completed_at: new Date(),
      },
    });

    return loadCheckOrThrow(tx, id);
  });
}

export async function deleteInventoryCheck(id: string) {
  return prisma.$transaction(async (tx) => {
    await assertInProgress(tx, id);
    await tx.inventoryCheck.delete({ where: { id } });
  });
}
