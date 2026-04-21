import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import type { LowStockQuery } from './schema.js';

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
