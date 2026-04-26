import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type {
  CreateFloorDecorInput,
  ListFloorDecorQuery,
  UpdateFloorDecorInput,
} from './schema.js';

async function assertZoneExists(zoneId: string): Promise<void> {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true },
  });
  if (!zone) throw new BadRequestError('zone_id references a non-existent zone');
}

export async function createFloorDecor(input: CreateFloorDecorInput) {
  await assertZoneExists(input.zone_id);
  return prisma.floorDecor.create({ data: input });
}

export async function listFloorDecor(query: ListFloorDecorQuery) {
  const where: Prisma.FloorDecorWhereInput = {
    ...(query.zone_id ? { zone_id: query.zone_id } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  return prisma.floorDecor.findMany({
    where,
    orderBy: [{ zone_id: 'asc' }, { created_at: 'asc' }],
  });
}

export async function getFloorDecor(id: string) {
  const row = await prisma.floorDecor.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('FloorDecor');
  return row;
}

export async function updateFloorDecor(id: string, input: UpdateFloorDecorInput) {
  await getFloorDecor(id);
  if (input.zone_id) await assertZoneExists(input.zone_id);
  return prisma.floorDecor.update({ where: { id }, data: input });
}

// Decor has no order history to preserve, so a hard delete is fine. Keeping
// `active=false` semantics open for callers that want a soft-delete via PATCH.
export async function deleteFloorDecor(id: string) {
  await getFloorDecor(id);
  return prisma.floorDecor.delete({ where: { id } });
}
