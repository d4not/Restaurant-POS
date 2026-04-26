import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type { CreateZoneInput, ListZoneQuery, UpdateZoneInput } from './schema.js';

// The TAKEOUT zone is a system-managed singleton seeded by the migration.
// Users only manage DINE_IN zones through the API — preventing TAKEOUT creates
// here keeps the singleton invariant simple and avoids race conditions on the
// partial unique index.
export async function createZone(input: CreateZoneInput) {
  if (input.kind === 'TAKEOUT') {
    throw new BadRequestError(
      'The takeout zone is created automatically and cannot be added manually',
    );
  }
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
  const zone = await getZone(id);

  // The TAKEOUT zone is system-managed; let the operator rename it and tweak
  // display_order, but block flipping kind, deactivating, or any other state
  // change that could break the singleton invariant.
  if (zone.kind === 'TAKEOUT') {
    if (input.kind && input.kind !== 'TAKEOUT') {
      throw new BadRequestError('Cannot change the kind of the takeout zone');
    }
    if (input.active === false) {
      throw new BadRequestError('The takeout zone cannot be deactivated');
    }
  }
  // Flipping a DINE_IN zone to TAKEOUT is no longer allowed via the API — the
  // takeout zone is exclusively the seeded one. Reject explicitly so the UI
  // can show a clear message.
  if (input.kind === 'TAKEOUT' && zone.kind !== 'TAKEOUT') {
    throw new BadRequestError(
      'Only the system-managed takeout zone can be of kind TAKEOUT',
    );
  }
  return prisma.zone.update({ where: { id }, data: input });
}

// Soft-delete: keep the row but mark inactive AND deactivate every table in
// the zone. A hard delete would cascade-delete tables (per the FK), and that
// would orphan historical orders' table_id (set to NULL by the orders FK).
// Inactivation preserves the link instead.
export async function deleteZone(id: string) {
  const zone = await getZone(id);
  if (zone.kind === 'TAKEOUT') {
    throw new BadRequestError('The takeout zone cannot be deleted');
  }
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
