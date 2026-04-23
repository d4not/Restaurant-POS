import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateZoneLabelInput,
  ListZoneLabelQuery,
  UpdateZoneLabelInput,
} from './schema.js';

async function assertZoneExists(zoneId: string): Promise<void> {
  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true } });
  if (!zone) throw new BadRequestError('zone_id references a non-existent zone');
}

export async function createZoneLabel(input: CreateZoneLabelInput) {
  await assertZoneExists(input.zone_id);
  return prisma.zoneLabel.create({ data: input });
}

export async function listZoneLabels(query: ListZoneLabelQuery) {
  const where: Prisma.ZoneLabelWhereInput = {
    ...(query.zone_id ? { zone_id: query.zone_id } : {}),
  };
  const rows = await prisma.zoneLabel.findMany({
    where,
    orderBy: [{ created_at: 'asc' }],
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getZoneLabel(id: string) {
  const row = await prisma.zoneLabel.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('ZoneLabel');
  return row;
}

export async function updateZoneLabel(id: string, input: UpdateZoneLabelInput) {
  await getZoneLabel(id);
  if (input.zone_id) await assertZoneExists(input.zone_id);
  return prisma.zoneLabel.update({ where: { id }, data: input });
}

export async function deleteZoneLabel(id: string) {
  await getZoneLabel(id);
  await prisma.zoneLabel.delete({ where: { id } });
}
