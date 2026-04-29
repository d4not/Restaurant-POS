import {
  CashMovementType,
  CashRegisterStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  StockMovementType,
  ProductType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { NotFoundError } from '../../lib/errors.js';
import type {
  DailySummaryQuery,
  ProductAnalysisQuery,
  ProductCostsQuery,
  ProductsSoldQuery,
  SupplyMovementsQuery,
  VarianceQuery,
} from './schema.js';

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

// ---------------------------------------------------------------------------
// Product analysis — per-product breakdown of sales, modifiers, and ingredients
// ---------------------------------------------------------------------------

export interface ProductAnalysisVariantRow {
  variant_id: string | null;
  variant_name: string;
  orders_count: number;
  total_revenue: string;
}

export interface ProductAnalysisModifierRow {
  modifier_id: string;
  modifier_name: string;
  times_used: number;
  extra_revenue: string;
}

export interface ProductAnalysisIngredientRow {
  supply_id: string;
  supply_name: string;
  total_quantity: string;
  unit: string;
  total_cost: string;
}

export interface ProductAnalysisReport {
  product_id: string;
  product_name: string;
  from: string;
  to: string;
  variant_sales: ProductAnalysisVariantRow[];
  modifier_usage: ProductAnalysisModifierRow[];
  ingredients_used: ProductAnalysisIngredientRow[];
}

export async function getProductAnalysisReport(
  query: ProductAnalysisQuery,
): Promise<ProductAnalysisReport> {
  const product = await prisma.product.findUnique({
    where: { id: query.product_id },
    select: { id: true, name: true },
  });
  if (!product) throw new NotFoundError('Product');

  // Only PAID orders within the window — open/cancelled orders never deducted
  // inventory and shouldn't show up in a revenue analysis.
  const items = await prisma.orderItem.findMany({
    where: {
      product_id: query.product_id,
      order: {
        status: OrderStatus.PAID,
        created_at: { gte: query.from, lte: query.to },
      },
    },
    select: {
      id: true,
      order_id: true,
      quantity: true,
      line_total: true,
      variant_id: true,
      variant: { select: { name: true } },
      modifiers: {
        select: {
          modifier_id: true,
          name: true,
          extra_price: true,
        },
      },
    },
  });

  // --- variant_sales ----------------------------------------------------------
  // Roll every line up by variant_id. Null variant_id (PRODUCT or a no-variant
  // DISH) rolls into a single row labeled "—".
  const variantMap = new Map<
    string,
    { variant_id: string | null; variant_name: string; orders: Set<string>; revenue: Decimal }
  >();
  for (const item of items) {
    const key = item.variant_id ?? '__no_variant__';
    let row = variantMap.get(key);
    if (!row) {
      row = {
        variant_id: item.variant_id,
        variant_name: item.variant?.name ?? '—',
        orders: new Set<string>(),
        revenue: new Decimal(0),
      };
      variantMap.set(key, row);
    }
    // orders_count counts distinct orders, not distinct lines — two Lattes on
    // the same order should count once so the number matches receipts.
    row.orders.add(item.order_id);
    row.revenue = row.revenue.add(new Decimal(item.line_total));
  }
  const variant_sales: ProductAnalysisVariantRow[] = [...variantMap.values()]
    .map((r) => ({
      variant_id: r.variant_id,
      variant_name: r.variant_name,
      orders_count: r.orders.size,
      total_revenue: r.revenue.toString(),
    }))
    .sort((a, b) => a.variant_name.localeCompare(b.variant_name));

  // --- modifier_usage --------------------------------------------------------
  // Each OrderItemModifier row = one use of the modifier on a single line; for
  // a line of quantity 2, the modifier was used twice. Scale accordingly.
  const modifierMap = new Map<
    string,
    { modifier_id: string; modifier_name: string; times_used: number; extra: Decimal }
  >();
  const qtyByItem = new Map(items.map((i) => [i.id, i.quantity]));
  for (const item of items) {
    const lineQty = qtyByItem.get(item.id) ?? 1;
    for (const m of item.modifiers) {
      let row = modifierMap.get(m.modifier_id);
      if (!row) {
        row = {
          modifier_id: m.modifier_id,
          modifier_name: m.name,
          times_used: 0,
          extra: new Decimal(0),
        };
        modifierMap.set(m.modifier_id, row);
      }
      row.times_used += lineQty;
      row.extra = row.extra.add(new Decimal(m.extra_price).mul(lineQty));
    }
  }
  const modifier_usage: ProductAnalysisModifierRow[] = [...modifierMap.values()]
    .map((r) => ({
      modifier_id: r.modifier_id,
      modifier_name: r.modifier_name,
      times_used: r.times_used,
      extra_revenue: r.extra.toString(),
    }))
    .sort((a, b) => b.times_used - a.times_used);

  // --- ingredients_used ------------------------------------------------------
  // Pull the SALE stock movements for every order that contained this product,
  // then sum quantity and cost per supply. Note: a shared-order movement counts
  // even if the order had other products — the caller is asking about this
  // product's footprint, and the StockMovement doesn't know which line drove it.
  // For a product-focused ingredient read, prefer the order-level endpoint.
  const orderIds = [...new Set(items.map((i) => i.order_id))];
  let ingredients_used: ProductAnalysisIngredientRow[] = [];
  if (orderIds.length > 0) {
    const movements = await prisma.stockMovement.findMany({
      where: {
        reference_type: 'Order',
        reference_id: { in: orderIds },
        type: StockMovementType.SALE,
      },
      select: {
        supply_id: true,
        quantity: true,
        unit_cost: true,
        supply: { select: { name: true, base_unit: true } },
      },
    });

    const ingMap = new Map<
      string,
      { supply_id: string; supply_name: string; unit: string; qty: Decimal; cost: Decimal }
    >();
    for (const m of movements) {
      let row = ingMap.get(m.supply_id);
      if (!row) {
        row = {
          supply_id: m.supply_id,
          supply_name: m.supply.name,
          unit: m.supply.base_unit,
          qty: new Decimal(0),
          cost: new Decimal(0),
        };
        ingMap.set(m.supply_id, row);
      }
      // SALE movements are stored as negative quantities — flip to a positive
      // "used" value for the report.
      const qty = new Decimal(m.quantity).abs();
      row.qty = row.qty.add(qty);
      row.cost = row.cost.add(qty.mul(new Decimal(m.unit_cost)));
    }
    ingredients_used = [...ingMap.values()]
      .map((r) => ({
        supply_id: r.supply_id,
        supply_name: r.supply_name,
        total_quantity: r.qty.toString(),
        unit: r.unit,
        total_cost: r.cost.toString(),
      }))
      .sort((a, b) => a.supply_name.localeCompare(b.supply_name));
  }

  return {
    product_id: product.id,
    product_name: product.name,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    variant_sales,
    modifier_usage,
    ingredients_used,
  };
}

// ---------------------------------------------------------------------------
// Daily summary — cashier-facing one-shot view of a day's activity
// ---------------------------------------------------------------------------

export interface DailySummaryOrders {
  count: number;
  gross_revenue: string;
  net_revenue: string;
  tax_total: string;
  discount_total: string;
  avg_ticket: string;
}

export interface DailySummaryPaymentMethodRow {
  method: PaymentMethod;
  count: number;
  total: string;
}

export interface DailySummaryCashMovementItem {
  id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  created_at: string;
}

export interface DailySummaryCashMovements {
  cash_in_total: string;
  cash_out_total: string;
  items: DailySummaryCashMovementItem[];
}

export interface DailySummaryReport {
  date: string;
  register_id: string | null;
  orders: DailySummaryOrders;
  payment_methods: DailySummaryPaymentMethodRow[];
  cash_movements: DailySummaryCashMovements;
  // Only populated when register_id was supplied — opening_amount + cash payments
  // − change given + cash_in − cash_out, recomputed from primary tables (not the
  // CashRegister.expected_amount cache, which can drift after a close).
  expected_cash: string | null;
  generated_at: string;
}

function parseDateOrToday(date: string | undefined): Date {
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getDailySummary(query: DailySummaryQuery): Promise<DailySummaryReport> {
  const day = parseDateOrToday(query.date);
  const dayStart = day;
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const dayIso = day.toISOString().slice(0, 10);

  // If a register was requested, validate it exists so the response carries
  // explicit semantics (404 vs an empty register-scoped report).
  if (query.register_id) {
    const exists = await prisma.cashRegister.findUnique({
      where: { id: query.register_id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('CashRegister');
  }

  const orderWhere: Prisma.OrderWhereInput = {
    status: OrderStatus.PAID,
    order_date: dayStart,
    ...(query.register_id ? { register_id: query.register_id } : {}),
  };

  // Pull paid orders + their payments for the day. Aggregating in memory keeps
  // the SQL simple and lets us emit per-method rows + totals from one fetch.
  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true,
      subtotal: true,
      tax_amount: true,
      discount_amount: true,
      total: true,
      payments: {
        select: { id: true, method: true, amount: true, change_amount: true },
      },
    },
  });

  let grossRevenue = new Decimal(0);
  let netRevenue = new Decimal(0);
  let taxTotal = new Decimal(0);
  let discountTotal = new Decimal(0);
  const methodMap = new Map<PaymentMethod, { count: number; total: Decimal }>();
  let cashPaymentSum = new Decimal(0);
  let cashChangeSum = new Decimal(0);

  for (const o of orders) {
    grossRevenue = grossRevenue.add(new Decimal(o.total));
    netRevenue = netRevenue.add(new Decimal(o.subtotal));
    taxTotal = taxTotal.add(new Decimal(o.tax_amount));
    discountTotal = discountTotal.add(new Decimal(o.discount_amount));
    for (const p of o.payments) {
      const row = methodMap.get(p.method) ?? { count: 0, total: new Decimal(0) };
      row.count += 1;
      row.total = row.total.add(new Decimal(p.amount));
      methodMap.set(p.method, row);
      if (p.method === PaymentMethod.CASH) {
        cashPaymentSum = cashPaymentSum.add(new Decimal(p.amount));
        cashChangeSum = cashChangeSum.add(new Decimal(p.change_amount));
      }
    }
  }

  const orderCount = orders.length;
  const avgTicket = orderCount > 0 ? grossRevenue.div(orderCount) : new Decimal(0);

  // Cash movements scoped to either the day or a single register. When
  // register-scoped, fetch every movement on that register for the day window —
  // the register may have been opened on a previous day, so we filter by
  // created_at rather than register-open dates.
  const movementWhere: Prisma.CashMovementWhereInput = {
    created_at: { gte: dayStart, lt: dayEnd },
    ...(query.register_id
      ? { register_id: query.register_id }
      : { register: { opened_at: { lt: dayEnd } } }),
  };
  const movementRows = await prisma.cashMovement.findMany({
    where: movementWhere,
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      type: true,
      amount: true,
      reason: true,
      created_at: true,
    },
  });
  let cashInTotal = new Decimal(0);
  let cashOutTotal = new Decimal(0);
  const movementItems: DailySummaryCashMovementItem[] = movementRows.map((m) => {
    const amount = new Decimal(m.amount);
    if (m.type === CashMovementType.CASH_IN) cashInTotal = cashInTotal.add(amount);
    else cashOutTotal = cashOutTotal.add(amount);
    return {
      id: m.id,
      type: m.type,
      amount: amount.toString(),
      reason: m.reason,
      created_at: m.created_at.toISOString(),
    };
  });

  let expectedCash: string | null = null;
  if (query.register_id) {
    const register = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: query.register_id },
      select: { opening_amount: true, status: true },
    });
    // Only meaningful for an open register — once closed, the expected/actual
    // diff is already frozen on the register row.
    if (register.status === CashRegisterStatus.OPEN) {
      const expected = new Decimal(register.opening_amount)
        .add(cashPaymentSum)
        .sub(cashChangeSum)
        .add(cashInTotal)
        .sub(cashOutTotal);
      expectedCash = expected.toString();
    }
  }

  const paymentMethods: DailySummaryPaymentMethodRow[] = [...methodMap.entries()]
    .map(([method, v]) => ({ method, count: v.count, total: v.total.toString() }))
    .sort((a, b) => a.method.localeCompare(b.method));

  return {
    date: dayIso,
    register_id: query.register_id ?? null,
    orders: {
      count: orderCount,
      gross_revenue: grossRevenue.toString(),
      net_revenue: netRevenue.toString(),
      tax_total: taxTotal.toString(),
      discount_total: discountTotal.toString(),
      avg_ticket: avgTicket.toFixed(0),
    },
    payment_methods: paymentMethods,
    cash_movements: {
      cash_in_total: cashInTotal.toString(),
      cash_out_total: cashOutTotal.toString(),
      items: movementItems,
    },
    expected_cash: expectedCash,
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Products-sold — every (product × variant × modifier-combo) row sold in a
// window. Mirrors the "Productos" view in mainstream POS reporting tools.
// ---------------------------------------------------------------------------
//
// Grouping: items collapse into a single row when they share product_id +
// variant_id + the same modifier set. The modifier signature is the snapshot
// names sorted alphabetically and joined with ", " — that way "Pepperoni,
// Ranch" and "Ranch, Pepperoni" merge.
//
// "Discount" in this report covers BOTH voided line items and apportioned
// order-level discounts. The kitchen-side reading of quantity (89 pizzas
// rang up) often matters even when the customer wasn't charged for all of
// them, so we keep voided items in gross_sales/quantity and offset their
// full value through the discount column. That mirrors how Poster-style
// reports are read: gross − discount = revenue.
//
// A void only counts as a cancellation when the kitchen had already been
// told (sent_to_kitchen = true). Items removed before they ever fired are
// waiter typos with no operational impact — `removeOrderItem` hard-deletes
// those, so under normal operation they never reach this query, but we
// gate on sent_to_kitchen anyway to stay correct against legacy/seed data.
//
// Money per line:
//   gross_sales += line_total                 (always — includes voided)
//   discount    += line_total                 (when item is voided)
//                  +  order.discount × line_total / order.subtotal
//                                             (when item is live; subtotal
//                                              already excludes voided lines)
//   revenue      = gross_sales − discount
//   cost        += (variant.recipe_cost ?? product.recipe_cost) × quantity
//                                             (only live lines — voided items
//                                              never reached the kitchen for
//                                              cost-of-goods purposes)
//   profit       = revenue − cost

export interface ProductsSoldRow {
  key: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  variant_id: string | null;
  variant_name: string | null;
  modifier_signature: string;
  quantity: number;
  gross_sales: string;
  discount: string;
  revenue: string;
  cost: string;
  profit: string;
}

export interface ProductsSoldTotals {
  quantity: number;
  gross_sales: string;
  discount: string;
  revenue: string;
  cost: string;
  profit: string;
}

export interface ProductsSoldReport {
  from: string;
  to: string;
  filters: {
    category_id: string | null;
    user_id: string | null;
    q: string | null;
  };
  totals: ProductsSoldTotals;
  rows: ProductsSoldRow[];
}

export async function getProductsSoldReport(
  query: ProductsSoldQuery,
): Promise<ProductsSoldReport> {
  const itemWhere: Prisma.OrderItemWhereInput = {
    // Live items OR sent-then-voided items. Items voided before reaching
    // the kitchen are waiter typos and shouldn't appear at all.
    OR: [
      { voided_at: null },
      { voided_at: { not: null }, sent_to_kitchen: true },
    ],
    order: {
      status: OrderStatus.PAID,
      created_at: { gte: query.from, lte: query.to },
      ...(query.user_id ? { user_id: query.user_id } : {}),
    },
    ...(query.category_id ? { product: { category_id: query.category_id } } : {}),
    ...(query.q
      ? { product: { name: { contains: query.q, mode: 'insensitive' } } }
      : {}),
  };

  // Combining the category and search filters above when both are present.
  // Prisma's `where` shape collapses them — `product: { category_id, name: {…} }`
  // — so re-merge by hand when both apply.
  if (query.category_id && query.q) {
    itemWhere.product = {
      category_id: query.category_id,
      name: { contains: query.q, mode: 'insensitive' },
    };
  }

  const items = await prisma.orderItem.findMany({
    where: itemWhere,
    select: {
      id: true,
      quantity: true,
      line_total: true,
      voided_at: true,
      variant_id: true,
      variant: { select: { name: true, recipe_cost: true } },
      product: {
        select: {
          id: true,
          name: true,
          recipe_cost: true,
          category: { select: { id: true, name: true } },
        },
      },
      modifiers: {
        select: { name: true },
      },
      order: {
        select: { subtotal: true, discount_amount: true },
      },
    },
  });

  type Bucket = {
    product_id: string;
    product_name: string;
    category_id: string | null;
    category_name: string | null;
    variant_id: string | null;
    variant_name: string | null;
    modifier_signature: string;
    quantity: number;
    gross: Decimal;
    discount: Decimal;
    cost: Decimal;
  };
  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const modSignature = [...item.modifiers]
      .map((m) => m.name)
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    const key = `${item.product.id}|${item.variant_id ?? ''}|${modSignature}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        product_id: item.product.id,
        product_name: item.product.name,
        category_id: item.product.category?.id ?? null,
        category_name: item.product.category?.name ?? null,
        variant_id: item.variant_id,
        variant_name: item.variant?.name ?? null,
        modifier_signature: modSignature,
        quantity: 0,
        gross: new Decimal(0),
        discount: new Decimal(0),
        cost: new Decimal(0),
      };
      buckets.set(key, bucket);
    }

    const lineTotal = new Decimal(item.line_total);
    bucket.quantity += item.quantity;
    bucket.gross = bucket.gross.add(lineTotal);

    if (item.voided_at != null) {
      // Voided line: customer wasn't charged. Treat the whole line_total as a
      // discount and skip cost-of-goods (the line never produced revenue).
      bucket.discount = bucket.discount.add(lineTotal);
      continue;
    }

    const orderSubtotal = new Decimal(item.order.subtotal);
    const orderDiscount = new Decimal(item.order.discount_amount);
    if (orderDiscount.gt(0) && orderSubtotal.gt(0)) {
      bucket.discount = bucket.discount.add(
        orderDiscount.mul(lineTotal).div(orderSubtotal),
      );
    }

    const unitCost = item.variant
      ? new Decimal(item.variant.recipe_cost)
      : new Decimal(item.product.recipe_cost);
    bucket.cost = bucket.cost.add(unitCost.mul(item.quantity));
  }

  const rows: ProductsSoldRow[] = [];
  let totalQty = 0;
  let totalGross = new Decimal(0);
  let totalDiscount = new Decimal(0);
  let totalCost = new Decimal(0);

  for (const [key, b] of buckets) {
    const revenue = b.gross.sub(b.discount);
    const profit = revenue.sub(b.cost);
    totalQty += b.quantity;
    totalGross = totalGross.add(b.gross);
    totalDiscount = totalDiscount.add(b.discount);
    totalCost = totalCost.add(b.cost);
    rows.push({
      key,
      product_id: b.product_id,
      product_name: b.product_name,
      category_id: b.category_id,
      category_name: b.category_name,
      variant_id: b.variant_id,
      variant_name: b.variant_name,
      modifier_signature: b.modifier_signature,
      quantity: b.quantity,
      gross_sales: b.gross.toFixed(0),
      discount: b.discount.toFixed(0),
      revenue: revenue.toFixed(0),
      cost: b.cost.toFixed(0),
      profit: profit.toFixed(0),
    });
  }

  rows.sort((a, b) => b.quantity - a.quantity || a.product_name.localeCompare(b.product_name));

  const totalRevenue = totalGross.sub(totalDiscount);
  const totalProfit = totalRevenue.sub(totalCost);

  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    filters: {
      category_id: query.category_id ?? null,
      user_id: query.user_id ?? null,
      q: query.q ?? null,
    },
    totals: {
      quantity: totalQty,
      gross_sales: totalGross.toFixed(0),
      discount: totalDiscount.toFixed(0),
      revenue: totalRevenue.toFixed(0),
      cost: totalCost.toFixed(0),
      profit: totalProfit.toFixed(0),
    },
    rows,
  };
}
