import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateDeductionRuleInput,
  ListDeductionRuleQuery,
  UpdateDeductionRuleInput,
} from './schema.js';

const ruleInclude = {
  storage: { select: { id: true, name: true } },
} satisfies Prisma.DeductionRuleInclude;

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
