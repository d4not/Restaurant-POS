import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type { UpsertTareWeightInput } from './schema.js';

async function assertSupplyExists(supplyId: string): Promise<void> {
  const exists = await prisma.supply.findFirst({
    where: { id: supplyId, deleted_at: null },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('supply not found');
}

export async function getTareWeight(supplyId: string) {
  const row = await prisma.tareWeight.findUnique({ where: { supply_id: supplyId } });
  if (!row) throw new NotFoundError('TareWeight');
  return row;
}

export async function upsertTareWeight(supplyId: string, input: UpsertTareWeightInput) {
  await assertSupplyExists(supplyId);
  return prisma.tareWeight.upsert({
    where: { supply_id: supplyId },
    create: { supply_id: supplyId, ...input },
    update: input,
  });
}

export async function deleteTareWeight(supplyId: string) {
  const existing = await prisma.tareWeight.findUnique({
    where: { supply_id: supplyId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('TareWeight');
  await prisma.tareWeight.delete({ where: { supply_id: supplyId } });
}
