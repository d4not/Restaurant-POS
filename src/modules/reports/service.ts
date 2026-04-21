import { Prisma, StockMovementType, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import type { ProductCostsQuery, SupplyMovementsQuery, VarianceQuery } from './schema.js';

// ---------------------------------------------------------------------------
// Theoretical vs Actual variance
// ---------------------------------------------------------------------------
//
// For each (supply, storage) scoped to the requested window:
//   beginning      = current_stock − Σ movements where created_at >= from
//   ending         = current_stock − Σ movements where created_at > to
//   purchases      = Σ PURCHASE movement qty in window (>= 0)
//   theoretical    = Σ |SALE| movement qty in window  (what recipes said was used)
//   actual         = beginning + purchases − ending
//   variance       = actual − theoretical
//                    (+) → used more than recipes predicted → waste / theft / bad recipes
//                    (−) → used less than recipes predicted → over-portioning or recipe error
//
// Note: the SPEC's literal formula is `theoretical − actual`, but its
// interpretation ("positive = more used than recipes say") only holds under
// `actual − theoretical`. We follow the interpretation — that is the number
// an operator actually needs. Both raw components are returned so callers can
// recompute either direction.

export interface VarianceRow {
  supply_id: string;
  supply_name: string;
  storage_id: string;
  storage_name: string;
  base_unit: string;
  beginning: string;
  purchases: string;
  ending: string;
  actual_usage: string;
  theoretical_usage: string;
  variance: string;
  variance_cost: string;
  average_cost: string;
}

export interface VarianceReport {
  from: string;
  to: string;
  storage_id: string | null;
  rows: VarianceRow[];
}

export async function getVarianceReport(query: VarianceQuery): Promise<VarianceReport> {
  const storageFilter: Prisma.StockMovementWhereInput = query.storage_id
    ? { storage_id: query.storage_id }
    : {};
  const stockFilter: Prisma.StorageStockWhereInput = query.storage_id
    ? { storage_id: query.storage_id }
    : {};

  // All (supply, storage) pairs that either have stock now or had movements in
  // the window. Movements alone are not enough — a supply that was fully drained
  // down to 0 before the window still has a stock row, and we want to include
  // it if it had activity.
  const [stocks, movementPairs] = await Promise.all([
    prisma.storageStock.findMany({
      where: stockFilter,
      select: {
        supply_id: true,
        storage_id: true,
        quantity: true,
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        ...storageFilter,
        created_at: { gte: query.from, lte: query.to },
      },
      distinct: ['supply_id', 'storage_id'],
      select: { supply_id: true, storage_id: true },
    }),
  ]);

  const pairs = new Map<string, { supply_id: string; storage_id: string; current: Decimal }>();
  for (const s of stocks) {
    pairs.set(`${s.supply_id}|${s.storage_id}`, {
      supply_id: s.supply_id,
      storage_id: s.storage_id,
      current: new Decimal(s.quantity),
    });
  }
  for (const m of movementPairs) {
    const k = `${m.supply_id}|${m.storage_id}`;
    if (!pairs.has(k)) {
      pairs.set(k, { supply_id: m.supply_id, storage_id: m.storage_id, current: new Decimal(0) });
    }
  }
  if (pairs.size === 0) {
    return { from: query.from.toISOString(), to: query.to.toISOString(), storage_id: query.storage_id ?? null, rows: [] };
  }

  const supplyIds = [...new Set([...pairs.values()].map((p) => p.supply_id))];
  const storageIds = [...new Set([...pairs.values()].map((p) => p.storage_id))];
  const [supplies, storages] = await Promise.all([
    prisma.supply.findMany({
      where: { id: { in: supplyIds } },
      select: { id: true, name: true, base_unit: true, average_cost: true },
    }),
    prisma.storage.findMany({
      where: { id: { in: storageIds } },
      select: { id: true, name: true },
    }),
  ]);
  const supplyById = new Map(supplies.map((s) => [s.id, s]));
  const storageById = new Map(storages.map((s) => [s.id, s]));

  // Pull every movement touching our pairs in one query, then bucket in memory.
  const movements = await prisma.stockMovement.findMany({
    where: {
      supply_id: { in: supplyIds },
      ...storageFilter,
      created_at: { gte: query.from },
    },
    select: {
      supply_id: true,
      storage_id: true,
      type: true,
      quantity: true,
      created_at: true,
    },
  });

  const after = await prisma.stockMovement.findMany({
    where: {
      supply_id: { in: supplyIds },
      ...storageFilter,
      created_at: { gt: query.to },
    },
    select: { supply_id: true, storage_id: true, quantity: true },
  });

  type Bucket = {
    // Σ qty strictly after `to` — used to project ending inventory back from current.
    after: Decimal;
    // Σ qty from >= from — used to project beginning inventory back from current.
    // `after` is a subset of `inWindowPlusAfter`, so beginning = current − (in_window + after).
    inWindowPlusAfter: Decimal;
    purchases: Decimal;
    theoretical: Decimal;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (k: string): Bucket => {
    let b = buckets.get(k);
    if (!b) {
      b = {
        after: new Decimal(0),
        inWindowPlusAfter: new Decimal(0),
        purchases: new Decimal(0),
        theoretical: new Decimal(0),
      };
      buckets.set(k, b);
    }
    return b;
  };

  for (const m of movements) {
    const k = `${m.supply_id}|${m.storage_id}`;
    if (!pairs.has(k)) continue;
    const qty = new Decimal(m.quantity);
    const b = bucket(k);
    b.inWindowPlusAfter = b.inWindowPlusAfter.add(qty);
    if (m.created_at > query.to) continue;
    // in-window
    if (m.type === StockMovementType.PURCHASE) {
      b.purchases = b.purchases.add(qty);
    } else if (m.type === StockMovementType.SALE) {
      b.theoretical = b.theoretical.add(qty.abs());
    }
  }
  for (const m of after) {
    const k = `${m.supply_id}|${m.storage_id}`;
    if (!pairs.has(k)) continue;
    const b = bucket(k);
    b.after = b.after.add(new Decimal(m.quantity));
  }

  const rows: VarianceRow[] = [];
  for (const [k, pair] of pairs) {
    const b = bucket(k);
    const ending = pair.current.sub(b.after);
    const beginning = pair.current.sub(b.inWindowPlusAfter);
    const actual = beginning.add(b.purchases).sub(ending);
    const variance = actual.sub(b.theoretical);
    const supply = supplyById.get(pair.supply_id);
    const storage = storageById.get(pair.storage_id);
    if (!supply || !storage) continue;
    const avg = new Decimal(supply.average_cost);
    rows.push({
      supply_id: pair.supply_id,
      supply_name: supply.name,
      storage_id: pair.storage_id,
      storage_name: storage.name,
      base_unit: supply.base_unit,
      beginning: beginning.toString(),
      purchases: b.purchases.toString(),
      ending: ending.toString(),
      actual_usage: actual.toString(),
      theoretical_usage: b.theoretical.toString(),
      variance: variance.toString(),
      variance_cost: variance.mul(avg).toString(),
      average_cost: avg.toString(),
    });
  }

  rows.sort((a, b) =>
    a.storage_name.localeCompare(b.storage_name) || a.supply_name.localeCompare(b.supply_name),
  );

  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    storage_id: query.storage_id ?? null,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Supply movements report
// ---------------------------------------------------------------------------

export interface SupplyMovementRow {
  id: string;
  created_at: string;
  storage_id: string;
  storage_name: string;
  type: StockMovementType;
  quantity: string;
  unit_cost: string;
  reference_type: string;
  reference_id: string;
}

export interface SupplyMovementSummary {
  purchases_in: string;
  sales_out: string;
  transfers_in: string;
  transfers_out: string;
  write_offs_out: string;
  adjustments_net: string;
  manufacture_in: string;
  net_change: string;
}

export interface SupplyMovementReport {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  from: string;
  to: string;
  storage_id: string | null;
  summary: SupplyMovementSummary;
  movements: SupplyMovementRow[];
}

export async function getSupplyMovementReport(
  query: SupplyMovementsQuery,
): Promise<SupplyMovementReport> {
  const supply = await prisma.supply.findUnique({
    where: { id: query.supply_id },
    select: { id: true, name: true, base_unit: true },
  });
  if (!supply) {
    return {
      supply_id: query.supply_id,
      supply_name: '',
      base_unit: '',
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      storage_id: query.storage_id ?? null,
      summary: emptySummary(),
      movements: [],
    };
  }

  const where: Prisma.StockMovementWhereInput = {
    supply_id: query.supply_id,
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    created_at: { gte: query.from, lte: query.to },
  };

  const rows = await prisma.stockMovement.findMany({
    where,
    include: { storage: { select: { id: true, name: true } } },
    orderBy: { created_at: 'asc' },
  });

  const summary = emptySummary();
  let net = new Decimal(0);
  for (const r of rows) {
    const q = new Decimal(r.quantity);
    net = net.add(q);
    switch (r.type) {
      case StockMovementType.PURCHASE:
        summary.purchases_in = new Decimal(summary.purchases_in).add(q).toString();
        break;
      case StockMovementType.SALE:
        summary.sales_out = new Decimal(summary.sales_out).add(q.abs()).toString();
        break;
      case StockMovementType.TRANSFER_IN:
        summary.transfers_in = new Decimal(summary.transfers_in).add(q).toString();
        break;
      case StockMovementType.TRANSFER_OUT:
        summary.transfers_out = new Decimal(summary.transfers_out).add(q.abs()).toString();
        break;
      case StockMovementType.WRITE_OFF:
        summary.write_offs_out = new Decimal(summary.write_offs_out).add(q.abs()).toString();
        break;
      case StockMovementType.ADJUSTMENT:
        summary.adjustments_net = new Decimal(summary.adjustments_net).add(q).toString();
        break;
      case StockMovementType.MANUFACTURE:
        summary.manufacture_in = new Decimal(summary.manufacture_in).add(q).toString();
        break;
    }
  }
  summary.net_change = net.toString();

  return {
    supply_id: supply.id,
    supply_name: supply.name,
    base_unit: supply.base_unit,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    storage_id: query.storage_id ?? null,
    summary,
    movements: rows.map((r) => ({
      id: r.id,
      created_at: r.created_at.toISOString(),
      storage_id: r.storage.id,
      storage_name: r.storage.name,
      type: r.type,
      quantity: new Decimal(r.quantity).toString(),
      unit_cost: new Decimal(r.unit_cost).toString(),
      reference_type: r.reference_type,
      reference_id: r.reference_id,
    })),
  };
}

function emptySummary(): SupplyMovementSummary {
  return {
    purchases_in: '0',
    sales_out: '0',
    transfers_in: '0',
    transfers_out: '0',
    write_offs_out: '0',
    adjustments_net: '0',
    manufacture_in: '0',
    net_change: '0',
  };
}

// ---------------------------------------------------------------------------
// Product cost report
// ---------------------------------------------------------------------------

export interface ProductCostVariantRow {
  variant_id: string;
  variant_name: string;
  sell_price: string;
  recipe_cost: string;
  food_cost_pct: string;
  gross_margin: string;
  active: boolean;
}

export interface ProductCostRow {
  product_id: string;
  product_name: string;
  type: ProductType;
  category_id: string | null;
  category_name: string | null;
  sell_price: string | null;
  recipe_cost: string;
  food_cost_pct: string;
  markup: string;
  gross_margin: string | null;
  active: boolean;
  variants: ProductCostVariantRow[];
}

export interface ProductCostReport {
  generated_at: string;
  rows: ProductCostRow[];
}

export async function getProductCostReport(query: ProductCostsQuery): Promise<ProductCostReport> {
  const products = await prisma.product.findMany({
    where: {
      deleted_at: null,
      ...(query.active_only ? { active: true } : {}),
      // Preparations have no sell_price and aren't useful in this report.
      type: { in: [ProductType.PRODUCT, ProductType.DISH] },
    },
    include: {
      category: { select: { id: true, name: true } },
      variants: {
        where: query.active_only ? { active: true } : undefined,
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      },
    },
    orderBy: [{ name: 'asc' }],
  });

  const rows: ProductCostRow[] = products.map((p) => {
    const sellPrice = p.sell_price ? new Decimal(p.sell_price) : null;
    const cost = new Decimal(p.recipe_cost);
    const grossMargin = sellPrice ? sellPrice.sub(cost) : null;
    return {
      product_id: p.id,
      product_name: p.name,
      type: p.type,
      category_id: p.category_id,
      category_name: p.category?.name ?? null,
      sell_price: sellPrice?.toString() ?? null,
      recipe_cost: cost.toString(),
      food_cost_pct: new Decimal(p.food_cost_pct).toString(),
      markup: new Decimal(p.markup).toString(),
      gross_margin: grossMargin?.toString() ?? null,
      active: p.active,
      variants: p.variants.map((v) => {
        const vPrice = new Decimal(v.sell_price);
        const vCost = new Decimal(v.recipe_cost);
        return {
          variant_id: v.id,
          variant_name: v.name,
          sell_price: vPrice.toString(),
          recipe_cost: vCost.toString(),
          food_cost_pct: new Decimal(v.food_cost_pct).toString(),
          gross_margin: vPrice.sub(vCost).toString(),
          active: v.active,
        };
      }),
    };
  });

  return {
    generated_at: new Date().toISOString(),
    rows,
  };
}
