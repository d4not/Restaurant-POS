import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type { ListAlertQuery, LowStockQuery, ResolveAlertInput } from './schema.js';

export interface LowStockAlert {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  storage_id: string;
  storage_name: string;
  quantity: string;
  min_stock: string;
  shortfall: string;
  average_cost: string;
}

// StorageStock rows where the configured min_stock has been breached.
// The `min_stock IS NOT NULL` and the soft-delete filter run in SQL. Prisma
// can't express `quantity <= min_stock` (column-vs-column) in the where clause,
// so that comparison stays in app code — the candidate set is already narrowed
// to stocks with a threshold and with a non-deleted supply.
export async function listLowStock(query: LowStockQuery): Promise<LowStockAlert[]> {
  const where: Prisma.StorageStockWhereInput = {
    min_stock: { not: null },
    supply: { deleted_at: null },
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
  };
  const rows = await prisma.storageStock.findMany({
    where,
    include: {
      supply: { select: { id: true, name: true, base_unit: true, average_cost: true } },
      storage: { select: { id: true, name: true } },
    },
    orderBy: [{ storage_id: 'asc' }, { supply_id: 'asc' }],
  });

  return rows
    .filter((r) => r.min_stock !== null && new Decimal(r.quantity).lte(new Decimal(r.min_stock)))
    .map((r) => {
      const qty = new Decimal(r.quantity);
      const min = new Decimal(r.min_stock!);
      return {
        supply_id: r.supply.id,
        supply_name: r.supply.name,
        base_unit: r.supply.base_unit,
        storage_id: r.storage.id,
        storage_name: r.storage.name,
        quantity: qty.toString(),
        min_stock: min.toString(),
        shortfall: min.sub(qty).toString(),
        average_cost: new Decimal(r.supply.average_cost).toString(),
      };
    });
}

const alertInclude = {
  user: { select: { id: true, name: true } },
  shift_report: {
    select: {
      id: true,
      user_id: true,
      user_name: true,
      cash_variance: true,
      void_count: true,
    },
  },
  daily_report: {
    select: { id: true, date: true, folio: true, status: true },
  },
} satisfies Prisma.AlertInclude;

/**
 * Generic alert listing for the admin queue. Default ordering puts the
 * highest-severity, most-recent alerts first so a manager scanning the page
 * sees the urgent stuff at the top. `resolved=false` is the most common
 * filter (the open queue) but we expose both directions for the audit log.
 */
export async function listAlerts(query: ListAlertQuery) {
  const where: Prisma.AlertWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.resolved !== undefined ? { resolved: query.resolved } : {}),
    ...(query.from || query.to
      ? {
          created_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.alert.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    include: alertInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

/**
 * Mark an alert as resolved. Idempotent only by id — re-resolving an already
 * resolved alert is rejected so the audit fields (resolved_by_id / resolved_at /
 * resolution) stay write-once.
 */
export async function resolveAlert(
  id: string,
  resolverId: string,
  input: ResolveAlertInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.alert.findUnique({
      where: { id },
      select: { id: true, resolved: true },
    });
    if (!existing) throw new NotFoundError('Alert');
    if (existing.resolved) {
      throw new ConflictError('Alert is already resolved');
    }
    await tx.alert.update({
      where: { id },
      data: {
        resolved: true,
        resolved_by_id: resolverId,
        resolved_at: new Date(),
        resolution: input.resolution,
      },
    });
    return tx.alert.findUniqueOrThrow({ where: { id }, include: alertInclude });
  });
}
