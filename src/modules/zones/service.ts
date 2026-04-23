import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type { CreateZoneInput, ListZoneQuery, UpdateZoneInput } from './schema.js';

export async function createZone(input: CreateZoneInput) {
  return prisma.zone.create({ data: input });
}

export async function listZones(query: ListZoneQuery) {
  const where: Prisma.ZoneWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  const rows = await prisma.zone.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: query.include_tables
      ? { tables: { orderBy: { number: 'asc' } } }
      : undefined,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getZone(id: string) {
  const row = await prisma.zone.findUnique({
    where: { id },
    include: { tables: { orderBy: { number: 'asc' } } },
  });
  if (!row) throw new NotFoundError('Zone');
  return row;
}

export async function updateZone(id: string, input: UpdateZoneInput) {
  await getZone(id);
  return prisma.zone.update({ where: { id }, data: input });
}

// Soft-delete: keep the row but mark inactive AND deactivate every table in
// the zone. A hard delete would cascade-delete tables (per the FK), and that
// would orphan historical orders' table_id (set to NULL by the orders FK).
// Inactivation preserves the link instead.
export async function deleteZone(id: string) {
  const zone = await getZone(id);
  // Block deletion if any active table in this zone is currently in use by
  // an OPEN order — releasing the order from the table on the way out is the
  // user's call to make, not ours.
  const activeOpen = await prisma.order.count({
    where: {
      status: 'OPEN',
      table: { zone_id: id },
    },
  });
  if (activeOpen > 0) {
    throw new ConflictError(
      `Cannot delete zone "${zone.name}" — it has ${activeOpen} open order(s) on its tables`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.table.updateMany({ where: { zone_id: id }, data: { active: false } });
    return tx.zone.update({ where: { id }, data: { active: false } });
  });
}
