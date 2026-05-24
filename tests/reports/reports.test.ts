import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ProductType } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
import { confirmPurchase } from '../../src/modules/purchases/service.js';
import { createVariantRecipe } from '../../src/modules/recipes/service.js';
import { deductSaleFromInventory } from '../../src/modules/sales/service.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeSupplier,
  makeSupplyCategory,
  makeStorage,
  makeSupply,
} from '../helpers/factories.js';

const app = getTestApp();

// A fixture that mirrors the seed scenario in miniature: purchase some milk
// into Barra, then sell a Latte variant that deducts 200ml. Enough data for
// every report to light up.

async function buyIntoBarra(
  supplierId: string,
  barraId: string,
  adminId: string,
  supplyId: string,
  qty: number,
  price: number,
  dateIso: string,
): Promise<string> {
  const purchase = await prisma.purchase.create({
    data: {
      supplier_id: supplierId,
      storage_id: barraId,
      date: new Date(dateIso),
      status: 'DRAFT',
      user_id: adminId,
      items: {
        create: [
          {
            supply_id: supplyId,
            package_quantity: qty,
            price_per_package: price,
            base_unit_quantity: 0,
            unit_cost: 0,
          },
        ],
      },
    },
  });
  await confirmPurchase(purchase.id);
  return purchase.id;
}

async function setup() {
  const [user, supplier, barra, bodega, dairy] = await Promise.all([
    makeUser(),
    makeSupplier({ name: 'Café Supplier' }),
    makeStorage({ name: 'Barra' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const milk = await makeSupply({
    category_id: dairy.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const cup = await makeSupply({
    category_id: dairy.id,
    name: 'Cup 12oz',
    base_unit: 'PIECE',
  });

  await buyIntoBarra(supplier.id, barra.id, user.id, milk.id, 6, 3600, '2026-04-18T09:00:00Z');
  await buyIntoBarra(supplier.id, barra.id, user.id, cup.id, 100, 360, '2026-04-18T09:00:00Z');

  const latte = await prisma.product.create({
    data: { name: 'Latte', type: ProductType.DISH },
  });
  const variant = await prisma.productVariant.create({
    data: { product_id: latte.id, name: 'Medium 12oz', sell_price: 6500 },
  });
  await createVariantRecipe(variant.id, {
    items: [
      { supply_id: milk.id, quantity: 200, unit: 'ml' },
      { supply_id: cup.id, quantity: 1, unit: 'piece' },
    ],
  });

  await prisma.deductionRule.create({
    data: { station_id: null, pos_register_id: null, storage_id: barra.id },
  });

  await deductSaleFromInventory(
    [{ product_id: latte.id, variant_id: variant.id, quantity: 1 }],
    null,
    randomUUID(),
  );

  return {
    auth: authHeader(user.id),
    userId: user.id,
    barraId: barra.id,
    bodegaId: bodega.id,
    milkId: milk.id,
    cupId: cup.id,
    latteProductId: latte.id,
    latteVariantId: variant.id,
  };
}

describe('GET /api/v1/reports/variance', () => {
  it('returns beginning/purchases/ending/actual/theoretical for the window', async () => {
    const s = await setup();
    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/variance?storage_id=${s.barraId}&from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);

    const rows = res.body.data.rows as Array<{
      supply_id: string;
      beginning: string;
      purchases: string;
      ending: string;
      actual_usage: string;
      theoretical_usage: string;
      variance: string;
    }>;
    const milkRow = rows.find((r) => r.supply_id === s.milkId);
    expect(milkRow).toBeDefined();
    expect(milkRow!.beginning).toBe('0');
    expect(milkRow!.purchases).toBe('6');
    // Recipe asks for 200ml of a 946ml bottle → 200/946 ≈ 0.21141649...
    const usage = new Decimal('200').div('946');
    const ending = new Decimal(6).sub(usage);
    expect(new Decimal(milkRow!.ending).sub(ending).abs().lt('0.0001')).toBe(true);
    expect(new Decimal(milkRow!.actual_usage).sub(usage).abs().lt('0.0001')).toBe(true);
    expect(new Decimal(milkRow!.theoretical_usage).sub(usage).abs().lt('0.0001')).toBe(true);
    // Perfect world — no variance.
    expect(new Decimal(milkRow!.variance).abs().lt('0.0001')).toBe(true);
  });

  it('reports a positive variance when a write-off drains stock beyond recipes', async () => {
    const s = await setup();
    // 50ml-worth of spilled milk: 50/946 ≈ 0.0529 bottles.
    const spilled = new Decimal(50).div(946);
    const milkSupply = await prisma.supply.findUniqueOrThrow({
      where: { id: s.milkId },
      select: { average_cost: true },
    });
    const writeOff = await prisma.writeOff.create({
      data: {
        storage_id: s.barraId,
        supply_id: s.milkId,
        quantity: spilled,
        reason: 'SPILLED',
        date: new Date(),
        user_id: s.userId,
      },
    });
    await prisma.storageStock.update({
      where: { supply_id_storage_id: { supply_id: s.milkId, storage_id: s.barraId } },
      data: { quantity: { decrement: spilled } },
    });
    await prisma.stockMovement.create({
      data: {
        supply_id: s.milkId,
        storage_id: s.barraId,
        type: 'WRITE_OFF',
        quantity: spilled.neg(),
        reference_type: 'WriteOff',
        reference_id: writeOff.id,
        unit_cost: milkSupply.average_cost,
      },
    });

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/variance?storage_id=${s.barraId}&from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);

    const milkRow = res.body.data.rows.find(
      (r: { supply_id: string }) => r.supply_id === s.milkId,
    );
    expect(new Decimal(milkRow.variance).sub(spilled).abs().lt('0.0001')).toBe(true);
    // variance_cost = variance × average_cost, always a non-zero Decimal string
    expect(new Decimal(milkRow.variance_cost).gt(0)).toBe(true);
  });

  it('rejects invalid date ranges', async () => {
    const s = await setup();
    const from = new Date('2026-04-10T00:00:00Z').toISOString();
    const to = new Date('2026-04-05T00:00:00Z').toISOString();
    await request(app)
      .get(`/api/v1/reports/variance?storage_id=${s.barraId}&from=${from}&to=${to}`)
      .set(s.auth)
      .expect(422);
  });

  it('rejects requests without auth', async () => {
    await request(app).get('/api/v1/reports/variance').expect(401);
  });
});

describe('GET /api/v1/reports/supply-movements', () => {
  it('returns every movement for a supply in the window with typed totals', async () => {
    const s = await setup();
    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/supply-movements?supply_id=${s.milkId}&from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);

    const data = res.body.data;
    expect(data.supply_id).toBe(s.milkId);
    // One PURCHASE, one SALE
    expect(data.movements).toHaveLength(2);
    expect(data.summary.purchases_in).toBe('6');
    const usage = new Decimal('200').div('946');
    expect(new Decimal(data.summary.sales_out).sub(usage).abs().lt('0.0001')).toBe(true);
    const net = new Decimal(6).sub(usage);
    expect(new Decimal(data.summary.net_change).sub(net).abs().lt('0.0001')).toBe(true);
  });

  it('scopes by storage_id when provided', async () => {
    const s = await setup();
    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(
        `/api/v1/reports/supply-movements?supply_id=${s.milkId}&storage_id=${s.bodegaId}&from=${from}&to=${to}`,
      )
      .set(s.auth)
      .expect(200);
    expect(res.body.data.movements).toHaveLength(0);
    expect(res.body.data.summary.net_change).toBe('0');
  });

  it('requires supply_id', async () => {
    const s = await setup();
    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date().toISOString();
    await request(app)
      .get(`/api/v1/reports/supply-movements?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(422);
  });
});

describe('GET /api/v1/reports/product-costs', () => {
  it('returns products with per-variant recipe cost and food cost percent', async () => {
    const s = await setup();
    const res = await request(app)
      .get('/api/v1/reports/product-costs')
      .set(s.auth)
      .expect(200);

    const rows = res.body.data.rows as Array<{
      product_id: string;
      variants: Array<{ variant_id: string; recipe_cost: string; food_cost_pct: string }>;
    }>;
    const latte = rows.find((r) => r.product_id === s.latteProductId);
    expect(latte).toBeDefined();
    expect(latte!.variants).toHaveLength(1);
    const variant = latte!.variants[0]!;
    expect(variant.variant_id).toBe(s.latteVariantId);
    // Milk WAC after the single purchase = 3600/1 = 3600c/bottle. Recipe uses
    // 200ml / 946ml bottle = 0.21141... bottles × 3600c ≈ 761.1 centavos.
    // Plus 1 cup @ WAC 360/1 = 360c. Total ≈ 1121.1c.
    const cost = new Decimal(variant.recipe_cost);
    expect(cost.gt(1100)).toBe(true);
    expect(cost.lt(1200)).toBe(true);
    // food_cost_pct = cost/6500 × 100 ≈ 17%
    const fc = new Decimal(variant.food_cost_pct);
    expect(fc.gt(15)).toBe(true);
    expect(fc.lt(20)).toBe(true);
  });

  it('excludes inactive variants when active_only=true (default)', async () => {
    const s = await setup();
    await prisma.productVariant.update({
      where: { id: s.latteVariantId },
      data: { active: false },
    });
    const res = await request(app)
      .get('/api/v1/reports/product-costs')
      .set(s.auth)
      .expect(200);
    const latte = res.body.data.rows.find(
      (r: { product_id: string }) => r.product_id === s.latteProductId,
    );
    expect(latte.variants).toHaveLength(0);
  });

  it('includes inactive variants when active_only=false', async () => {
    const s = await setup();
    await prisma.productVariant.update({
      where: { id: s.latteVariantId },
      data: { active: false },
    });
    const res = await request(app)
      .get('/api/v1/reports/product-costs?active_only=false')
      .set(s.auth)
      .expect(200);
    const latte = res.body.data.rows.find(
      (r: { product_id: string }) => r.product_id === s.latteProductId,
    );
    expect(latte.variants).toHaveLength(1);
  });
});

describe('GET /api/v1/reports/products-sold', () => {
  // Helper: create a PAID order directly via prisma so we don't go through the
  // full register-open / payment lifecycle. The aggregator only reads fields
  // (status, created_at, items, modifiers, discount/subtotal), so a minimal
  // record is enough.
  async function makePaidOrder(opts: {
    userId: string;
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    modifierNames?: string[];
    discountAmount?: number;
  }) {
    const register = await prisma.cashRegister.create({
      data: { user_id: opts.userId, opening_amount: 0, status: 'CLOSED' },
    });
    const lineTotal = opts.unitPrice * opts.quantity;
    const order = await prisma.order.create({
      data: {
        register_id: register.id,
        user_id: opts.userId,
        order_number: Math.floor(Math.random() * 100000),
        status: 'PAID',
        order_type: 'DINE_IN',
        subtotal: lineTotal,
        tax_amount: 0,
        discount_amount: opts.discountAmount ?? 0,
        total: lineTotal - (opts.discountAmount ?? 0),
        order_date: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    // Need at least one modifier in the system if names are given, so we wire
    // them up minimally via a dummy modifier_group + modifiers and snapshot
    // them on the order item.
    let modifierIds: string[] = [];
    if (opts.modifierNames?.length) {
      const group = await prisma.modifierGroup.create({
        data: { name: 'Test Group' },
      });
      modifierIds = await Promise.all(
        opts.modifierNames.map(async (name) => {
          const m = await prisma.modifier.create({
            data: { group_id: group.id, name, extra_price: 0 },
          });
          return m.id;
        }),
      );
    }
    await prisma.orderItem.create({
      data: {
        order_id: order.id,
        product_id: opts.productId,
        variant_id: opts.variantId,
        quantity: opts.quantity,
        unit_price: opts.unitPrice,
        line_total: lineTotal,
        modifiers: opts.modifierNames?.length
          ? {
              create: opts.modifierNames.map((name, i) => ({
                modifier_id: modifierIds[i]!,
                name,
                extra_price: 0,
              })),
            }
          : undefined,
      },
    });
    return order;
  }

  it('aggregates rows by (product, variant, modifier-set) with totals', async () => {
    const s = await setup();
    // Two orders that share product+variant+modifiers — should collapse into
    // one row with quantity = 1 + 2 = 3.
    await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 1,
      unitPrice: 6500,
      modifierNames: ['Almond Milk'],
    });
    await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 2,
      unitPrice: 6500,
      modifierNames: ['Almond Milk'],
    });
    // A third order with a different modifier set — separate row.
    await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 1,
      unitPrice: 6500,
      modifierNames: ['Soy Milk'],
    });

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date('2099-01-01T00:00:00Z').toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/products-sold?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);

    const data = res.body.data;
    const lattes = (data.rows as Array<{ product_id: string; quantity: number; modifier_signature: string; gross_sales: string }>).filter(
      (r) => r.product_id === s.latteProductId,
    );
    expect(lattes).toHaveLength(2);
    const almond = lattes.find((r) => r.modifier_signature === 'Almond Milk');
    const soy = lattes.find((r) => r.modifier_signature === 'Soy Milk');
    expect(almond).toBeDefined();
    expect(soy).toBeDefined();
    expect(almond!.quantity).toBe(3);
    expect(soy!.quantity).toBe(1);
    // 3 × 6500 = 19500
    expect(almond!.gross_sales).toBe('19500');

    // Totals
    expect(data.totals.quantity).toBeGreaterThanOrEqual(4);
    expect(Number(data.totals.gross_sales)).toBeGreaterThanOrEqual(26000);
  });

  it('apportions order-level discount across lines', async () => {
    const s = await setup();
    // One order with two items: each is 50% of the order so discount splits 50/50.
    const second = await prisma.product.create({
      data: { name: 'Espresso', type: ProductType.DISH },
    });
    const register = await prisma.cashRegister.create({
      data: { user_id: s.userId, opening_amount: 0, status: 'CLOSED' },
    });
    const subtotal = 10000;
    const order = await prisma.order.create({
      data: {
        register_id: register.id,
        user_id: s.userId,
        order_number: Math.floor(Math.random() * 100000),
        status: 'PAID',
        order_type: 'DINE_IN',
        subtotal,
        discount_amount: 1000,
        total: 9000,
        order_date: new Date(new Date().toISOString().slice(0, 10)),
        items: {
          create: [
            {
              product_id: s.latteProductId,
              variant_id: s.latteVariantId,
              quantity: 1,
              unit_price: 5000,
              line_total: 5000,
            },
            {
              product_id: second.id,
              quantity: 1,
              unit_price: 5000,
              line_total: 5000,
            },
          ],
        },
      },
    });
    expect(order.id).toBeDefined();

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date('2099-01-01T00:00:00Z').toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/products-sold?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);

    const rows = res.body.data.rows as Array<{
      product_id: string;
      gross_sales: string;
      discount: string;
      revenue: string;
    }>;
    const latteRow = rows.find((r) => r.product_id === s.latteProductId);
    const espressoRow = rows.find((r) => r.product_id === second.id);
    expect(latteRow).toBeDefined();
    expect(espressoRow).toBeDefined();
    // 1000 × 5000/10000 = 500 each
    expect(latteRow!.discount).toBe('500');
    expect(espressoRow!.discount).toBe('500');
    expect(latteRow!.revenue).toBe('4500');
    expect(espressoRow!.revenue).toBe('4500');
  });

  it('filters by user_id (waiter)', async () => {
    const s = await setup();
    const otherUser = await makeUser({ role: 'WAITER' });
    await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 5,
      unitPrice: 6500,
    });
    await makePaidOrder({
      userId: otherUser.id,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 2,
      unitPrice: 6500,
    });

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date('2099-01-01T00:00:00Z').toISOString();
    const res = await request(app)
      .get(
        `/api/v1/reports/products-sold?from=${from}&to=${to}&user_id=${otherUser.id}`,
      )
      .set(s.auth)
      .expect(200);
    expect(res.body.data.totals.quantity).toBe(2);
  });

  it('counts a sent-then-voided line as discount (real cancellation)', async () => {
    const s = await setup();
    const order = await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 4,
      unitPrice: 6500,
    });
    // Item was sent to kitchen, then voided — the kitchen prepared (or was
    // about to) so this is a real cancellation, not a typo.
    await prisma.orderItem.updateMany({
      where: { order_id: order.id },
      data: {
        sent_to_kitchen: true,
        sent_at: new Date(),
        voided_at: new Date(),
        voided_by: s.userId,
        void_reason: 'customer changed mind',
      },
    });

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date('2099-01-01T00:00:00Z').toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/products-sold?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);
    const lattes = (res.body.data.rows as Array<{
      product_id: string;
      quantity: number;
      gross_sales: string;
      discount: string;
      revenue: string;
      cost: string;
    }>).filter((r) => r.product_id === s.latteProductId);
    expect(lattes).toHaveLength(1);
    const row = lattes[0]!;
    expect(row.quantity).toBe(4);
    expect(row.gross_sales).toBe('26000');
    expect(row.discount).toBe('26000');
    expect(row.revenue).toBe('0');
    // Voided lines don't accrue cost-of-goods.
    expect(row.cost).toBe('0');
  });

  it('ignores voided lines that were never sent to kitchen (waiter typo)', async () => {
    const s = await setup();
    const order = await makePaidOrder({
      userId: s.userId,
      productId: s.latteProductId,
      variantId: s.latteVariantId,
      quantity: 3,
      unitPrice: 6500,
    });
    // Voided BEFORE the kitchen knew about it — equivalent to the waiter
    // hitting the wrong button. removeOrderItem hard-deletes this case in
    // production; we simulate it via direct prisma to be sure the report
    // hides it even when the data lingers.
    await prisma.orderItem.updateMany({
      where: { order_id: order.id },
      data: {
        sent_to_kitchen: false,
        voided_at: new Date(),
        voided_by: s.userId,
        void_reason: 'mis-press',
      },
    });

    const from = new Date('2026-04-01T00:00:00Z').toISOString();
    const to = new Date('2099-01-01T00:00:00Z').toISOString();
    const res = await request(app)
      .get(`/api/v1/reports/products-sold?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(200);
    const lattes = (res.body.data.rows as Array<{ product_id: string }>).filter(
      (r) => r.product_id === s.latteProductId,
    );
    expect(lattes).toHaveLength(0);
  });

  it('rejects invalid date ranges', async () => {
    const s = await setup();
    const from = new Date('2026-05-10T00:00:00Z').toISOString();
    const to = new Date('2026-05-05T00:00:00Z').toISOString();
    await request(app)
      .get(`/api/v1/reports/products-sold?from=${from}&to=${to}`)
      .set(s.auth)
      .expect(422);
  });
});
