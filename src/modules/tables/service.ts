import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateTableInput,
  ListTableQuery,
  UpdateTableInput,
  UpdateTableStatusInput,
} from './schema.js';

const tableInclude = {
  zone: { select: { id: true, name: true, display_order: true } },
} satisfies Prisma.TableInclude;

async function assertZoneAcceptsTables(zoneId: string): Promise<void> {
  const zone = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, kind: true, name: true },
  });
  if (!zone) throw new BadRequestError('zone_id references a non-existent zone');
  if (zone.kind === 'TAKEOUT') {
    throw new BadRequestError(
      `Zone "${zone.name}" is a takeout zone — it cannot host tables`,
    );
  }
}

export async function createTable(input: CreateTableInput) {
  await assertZoneAcceptsTables(input.zone_id);

  // If a soft-deleted table already occupies (zone_id, number), resurrect it
  // with the new layout instead of failing on the unique index. Soft-deleted
  // rows that still have order history can't be hard-deleted, so without this
  // path the user could never reuse that number.
  const existing = await prisma.table.findUnique({
    where: { zone_id_number: { zone_id: input.zone_id, number: input.number } },
    select: { id: true, active: true },
  });
  if (existing && !existing.active) {
    return prisma.table.update({
      where: { id: existing.id },
      data: { ...input, active: true },
      include: tableInclude,
    });
  }

  try {
    return await prisma.table.create({ data: input, include: tableInclude });
  } catch (err) {
    // P2002 → unique violation on (zone_id, number). Surface as a clear 409
    // so the UI can highlight the conflicting field instead of a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError(
        `Table number ${input.number} already exists in this zone`,
      );
    }
    throw err;
  }
}

export async function listTables(query: ListTableQuery) {
  const where: Prisma.TableWhereInput = {
    ...(query.zone_id ? { zone_id: query.zone_id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  const rows = await prisma.table.findMany({
    where,
    orderBy: [
      { zone: { display_order: 'asc' } },
      { zone: { name: 'asc' } },
      { number: 'asc' },
    ],
    include: tableInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getTable(id: string) {
  const row = await prisma.table.findUnique({ where: { id }, include: tableInclude });
  if (!row) throw new NotFoundError('Table');
  return row;
}

export async function updateTable(id: string, input: UpdateTableInput) {
  await getTable(id);
  if (input.zone_id) await assertZoneAcceptsTables(input.zone_id);
  try {
    return await prisma.table.update({
      where: { id },
      data: input,
      include: tableInclude,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError(
        `Table number ${input.number} already exists in this zone`,
      );
    }
    throw err;
  }
}

// Manual status flip (e.g. front-of-house marks a table RESERVED). The
// Order lifecycle does its own status updates inline; this endpoint is for
// out-of-band changes only.
export async function updateTableStatus(id: string, input: UpdateTableStatusInput) {
  await getTable(id);
  return prisma.table.update({
    where: { id },
    data: { status: input.status },
    include: tableInclude,
  });
}

// Hard-delete when the table has no order history; soft-delete otherwise so
// historical orders' table_id link remains resolvable. Without the hard-delete
// branch, every cleared table left a zombie row blocking the next reuse of its
// number — the operator had no way to free the slot from the floor plan.
export async function deleteTable(id: string) {
  const table = await getTable(id);
  const openOrders = await prisma.order.count({
    where: { table_id: id, status: 'OPEN' },
  });
  if (openOrders > 0) {
    throw new ConflictError(
      `Cannot delete table ${table.number} — it has ${openOrders} open order(s)`,
    );
  }
  const totalOrders = await prisma.order.count({ where: { table_id: id } });
  if (totalOrders === 0) {
    return prisma.table.delete({ where: { id } });
  }
  return prisma.table.update({ where: { id }, data: { active: false } });
}
