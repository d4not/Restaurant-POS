import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateDeductionRuleInput,
  ListDeductionRuleQuery,
  UpdateDeductionRuleInput,
} from './schema.js';

type PrismaLike = Prisma.TransactionClient | typeof prisma;

const ruleInclude = {
  storage: { select: { id: true, name: true } },
} satisfies Prisma.DeductionRuleInclude;

// Pick the most specific DeductionRule. Order: (station + register) → station
// → register → default (both null). Returns null if no rule exists — callers
// then fall back to per-supply last-received storage.
export async function resolveRuleStorage(
  client: PrismaLike,
  stationId: string | null | undefined,
  posRegisterId: string | null | undefined,
): Promise<string | null> {
  if (stationId && posRegisterId) {
    const both = await client.deductionRule.findFirst({
      where: { station_id: stationId, pos_register_id: posRegisterId },
      select: { storage_id: true },
    });
    if (both) return both.storage_id;
  }
  if (stationId) {
    const byStation = await client.deductionRule.findFirst({
      where: { station_id: stationId, pos_register_id: null },
      select: { storage_id: true },
    });
    if (byStation) return byStation.storage_id;
  }
  if (posRegisterId) {
    const byRegister = await client.deductionRule.findFirst({
      where: { station_id: null, pos_register_id: posRegisterId },
      select: { storage_id: true },
    });
    if (byRegister) return byRegister.storage_id;
  }
  const fallback = await client.deductionRule.findFirst({
    where: { station_id: null, pos_register_id: null },
    select: { storage_id: true },
  });
  return fallback?.storage_id ?? null;
}

// Per-supply fallback: where did this supply last arrive? The strict variant
// (used by sale-time deduction) throws when no purchase exists — the cashier
// can't sell a recipe ingredient that has never been received. The soft
// variant (used by availability checks) returns null so the engine can mark
// the line as `unknown` rather than 400 the whole bulk endpoint.
export async function resolveStorageFromLastPurchase(
  client: PrismaLike,
  supplyId: string,
): Promise<string> {
  const storage = await resolveStorageFromLastPurchaseOrNull(client, supplyId);
  if (!storage) {
    throw new BadRequestError(
      `No deduction rule matched and supply ${supplyId} has no purchase history — cannot determine storage to deduct from`,
    );
  }
  return storage;
}

export async function resolveStorageFromLastPurchaseOrNull(
  client: PrismaLike,
  supplyId: string,
): Promise<string | null> {
  const last = await client.stockMovement.findFirst({
    where: { supply_id: supplyId, type: StockMovementType.PURCHASE },
    orderBy: { created_at: 'desc' },
    select: { storage_id: true },
  });
  return last?.storage_id ?? null;
}

async function assertStorageExists(
  client: Prisma.TransactionClient | typeof prisma,
  storageId: string,
): Promise<void> {
  const storage = await client.storage.findUnique({
    where: { id: storageId },
    select: { id: true },
  });
  if (!storage) throw new BadRequestError('storage_id references a non-existent storage');
}

export async function createDeductionRule(input: CreateDeductionRuleInput) {
  await assertStorageExists(prisma, input.storage_id);
  return prisma.deductionRule.create({
    data: {
      station_id: input.station_id ?? null,
      pos_register_id: input.pos_register_id ?? null,
      storage_id: input.storage_id,
    },
    include: ruleInclude,
  });
}

export async function listDeductionRules(query: ListDeductionRuleQuery) {
  const where: Prisma.DeductionRuleWhereInput = {
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.station_id ? { station_id: query.station_id } : {}),
    ...(query.pos_register_id ? { pos_register_id: query.pos_register_id } : {}),
  };
  const rows = await prisma.deductionRule.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: ruleInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getDeductionRule(id: string) {
  const row = await prisma.deductionRule.findUnique({
    where: { id },
    include: ruleInclude,
  });
  if (!row) throw new NotFoundError('DeductionRule');
  return row;
}

export async function updateDeductionRule(id: string, input: UpdateDeductionRuleInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.deductionRule.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundError('DeductionRule');
    if (input.storage_id) {
      await assertStorageExists(tx, input.storage_id);
    }
    return tx.deductionRule.update({
      where: { id },
      data: {
        ...(input.storage_id !== undefined ? { storage_id: input.storage_id } : {}),
        ...(input.station_id !== undefined ? { station_id: input.station_id } : {}),
        ...(input.pos_register_id !== undefined
          ? { pos_register_id: input.pos_register_id }
          : {}),
      },
      include: ruleInclude,
    });
  });
}

export async function deleteDeductionRule(id: string) {
  const existing = await prisma.deductionRule.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('DeductionRule');
  await prisma.deductionRule.delete({ where: { id } });
}
