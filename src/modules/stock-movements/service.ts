import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type { ListStockMovementQuery } from './schema.js';

const movementInclude = {
  supply: { select: { id: true, name: true, base_unit: true } },
  storage: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementInclude;

export async function listStockMovements(query: ListStockMovementQuery) {
  const where: Prisma.StockMovementWhereInput = {
    ...(query.supply_id ? { supply_id: query.supply_id } : {}),
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.reference_type ? { reference_type: query.reference_type } : {}),
    ...(query.reference_id ? { reference_id: query.reference_id } : {}),
    ...(query.from || query.to
      ? {
          created_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.stockMovement.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    include: movementInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getStockMovement(id: string) {
  const row = await prisma.stockMovement.findUnique({
    where: { id },
    include: movementInclude,
  });
  if (!row) throw new NotFoundError('StockMovement');
  return row;
}
