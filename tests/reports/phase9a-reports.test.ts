import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupplier,
  makeSupply,
  makeSupplyCategory,
  makeUser,
} from '../helpers/factories.js';

const app = getTestApp();

// Phase 9A.4 + 9A.5 — product analysis + per-order ingredient breakdown
// endpoints. Both ride on the StockMovement audit log (SALE type, reference
// Order) and the OrderItem/Modifier snapshot columns.

interface Seed {
  auth: Record<string, string>;
  registerId: string;
  barraId: string;
  supplyIds: { milk: string; espresso: string; water: string };
  latteProductId: string;
  latteSmallId: string;
  latteLargeId: string;
  waterProductId: string;
  extraShotModifierId: string;
  vanillaModifierId: string;
}

async function buyInto(
  auth: Record<string, string>,
  supplierId: string,
  storageId: string,
  supplyId: string,
  packageQuantity: number,
  pricePerPackage: number,
): Promise<void> {
  const draft = await request(app).post('/api/v1/purchases').set(auth).send({
    supplier_id: supplierId,
    storage_id: storageId,
    date: '2026-04-21T00:00:00Z',
    items: [
      {
        supply_id: supplyId,
        packaging_id: null,
        package_quantity: packageQuantity,
        price_per_package: pricePerPackage,
      },
    ],
  });
  expect(draft.status).toBe(201);
  await request(app)
    .post(`/api/v1/purchases/${draft.body.data.id}/confirm`)
    .set(auth)
    .expect(200);
}

async function seedScenario(): Promise<Seed> {
  const [user, supplier, barra, dairyCat, coffeeCat, bottledCat, syrupCat] = await Promise.all([
    makeUser(),
    makeSupplier(),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Dairy' }),
    makeSupplyCategory({ name: 'Coffee' }),
    makeSupplyCategory({ name: 'Bottled' }),
    makeSupplyCategory({ name: 'Syrup' }),
  ]);
  const auth = authHeader(user.id);

  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const espresso = await makeSupply({
    category_id: coffeeCat.id,
    name: 'Espresso Beans 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });
  const water = await makeSupply({
    category_id: bottledCat.id,
    name: 'Bottled Water',
    base_unit: 'BOTTLE',
  });
  const vanilla = await makeSupply({
    category_id: syrupCat.id,
    name: 'Vanilla Syrup',
    base_unit: 'BOTTLE',
    content_per_unit: 750,
    content_unit: 'ML',
  });

  await buyInto(auth, supplier.id, barra.id, milk.id, 10, 3000);
  await buyInto(auth, supplier.id, barra.id, espresso.id, 2, 40000);
  await buyInto(auth, supplier.id, barra.id, water.id, 24, 1200);
  await buyInto(auth, supplier.id, barra.id, vanilla.id, 4, 18000);

  const category = await request(app)
    .post('/api/v1/product-categories')
    .set(auth)
    .send({ name: 'Hot Coffee' })
    .expect(201);

  const latte = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: category.body.data.id,
    sell_price: 5500,
  });
  const latteProductId = latte.body.data.id as string;

  const small = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Small 8oz', sell_price: 5500 })
    .expect(201);
  const latteSmallId = small.body.data.id as string;
  await request(app)
    .post(`/api/v1/recipes/variants/${latteSmallId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 150, unit: 'ml' },
        { supply_id: espresso.id, quantity: 14, unit: 'g' },
      ],
    })
    .expect(201);

  const large = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Large 16oz', sell_price: 7500 })
    .expect(201);
  const latteLargeId = large.body.data.id as string;
  await request(app)
    .post(`/api/v1/recipes/variants/${latteLargeId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 280, unit: 'ml' },
        { supply_id: espresso.id, quantity: 22, unit: 'g' },
      ],
    })
    .expect(201);

  const waterProduct = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Bottled Water',
    type: 'PRODUCT',
    sell_price: 2500,
    supply_id: water.id,
  });
  expect(waterProduct.status).toBe(201);

  const extrasGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Extras',
    type: 'ADD',
    max_selection: 3,
  });
  expect(extrasGroup.status).toBe(201);
  const extraShot = await request(app)
    .post(`/api/v1/modifier-groups/${extrasGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Extra Shot',
      extra_price: 1500,
      supply_id: espresso.id,
      supply_quantity: 9,
      supply_unit: 'g',
    });
  expect(extraShot.status).toBe(201);
  const vanillaMod = await request(app)
    .post(`/api/v1/modifier-groups/${extrasGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Vanilla Syrup',
      extra_price: 800,
      supply_id: vanilla.id,
      supply_quantity: 15,
      supply_unit: 'ml',
    });
  expect(vanillaMod.status).toBe(201);

  await request(app)
    .post(`/api/v1/products/${latteProductId}/modifier-groups`)
    .set(auth)
    .send({ modifier_group_id: extrasGroup.body.data.id })
    .expect(201);

  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 50000 })
    .expect(201);
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
    .expect(201);

  return {
    auth,
    registerId: register.body.data.id as string,
    barraId: barra.id,
    supplyIds: { milk: milk.id, espresso: espresso.id, water: water.id },
    latteProductId,
    latteSmallId,
    latteLargeId,
    waterProductId: waterProduct.body.data.id as string,
    extraShotModifierId: extraShot.body.data.id as string,
    vanillaModifierId: vanillaMod.body.data.id as string,
  };
}

async function placeAndPay(
  s: Seed,
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity?: number;
    modifier_ids?: string[];
  }>,
): Promise<string> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(s.auth)
    .send({ register_id: s.registerId, order_type: 'DINE_IN' })
    .expect(201);
  const orderId = order.body.data.id as string;
  for (const item of items) {
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send(item)
      .expect(201);
  }
  // Fetch the current total and pay it with CASH exactly.
  const latest = await request(app).get(`/api/v1/orders/${orderId}`).set(s.auth).expect(200);
  await request(app)
    .post(`/api/v1/orders/${orderId}/payments`)
    .set(s.auth)
    .send({ method: 'CASH', amount: Number(latest.body.data.total) })
    .expect(201);
  return orderId;
}

describe('Phase 9A.4 — GET /api/v1/reports/product-analysis', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('breaks down Latte sales by variant, modifier use, and aggregated ingredients', async () => {
    // 2× Latte Small + 1× Latte Large (with extra shot + vanilla).
    await placeAndPay(s, [
      { product_id: s.latteProductId, variant_id: s.latteSmallId, quantity: 2 },
    ]);
    await placeAndPay(s, [
      {
        product_id: s.latteProductId,
        variant_id: s.latteLargeId,
        quantity: 1,
        modifier_ids: [s.extraShotModifierId, s.vanillaModifierId],
      },
    ]);

    const from = '2026-01-01T00:00:00Z';
    const to = '2026-12-31T23:59:59Z';
    const res = await request(app)
      .get(
        `/api/v1/reports/product-analysis?product_id=${s.latteProductId}&from=${from}&to=${to}`,
      )
      .set(s.auth);
    expect(res.status).toBe(200);

    const { variant_sales, modifier_usage, ingredients_used } = res.body.data;

    // variant_sales: 2 rows, one per size. Small: 2 lattes, revenue 11000;
    // Large: 1 latte + modifiers = 7500 + 1500 + 800 = 9800.
    const small = variant_sales.find((v: { variant_id: string }) => v.variant_id === s.latteSmallId);
    const large = variant_sales.find((v: { variant_id: string }) => v.variant_id === s.latteLargeId);
    expect(small).toBeDefined();
    expect(small.orders_count).toBe(1);
    expect(small.total_revenue).toBe('11000');
    expect(large).toBeDefined();
    expect(large.orders_count).toBe(1);
    expect(large.total_revenue).toBe('9800');

    // modifier_usage: Extra Shot × 1, Vanilla × 1 (applied to the one Large).
    const extraShot = modifier_usage.find(
      (m: { modifier_id: string }) => m.modifier_id === s.extraShotModifierId,
    );
    expect(extraShot).toBeDefined();
    expect(extraShot.times_used).toBe(1);
    expect(extraShot.extra_revenue).toBe('1500');

    const vanilla = modifier_usage.find(
      (m: { modifier_id: string }) => m.modifier_id === s.vanillaModifierId,
    );
    expect(vanilla).toBeDefined();
    expect(vanilla.times_used).toBe(1);
    expect(vanilla.extra_revenue).toBe('800');

    // ingredients_used: milk, espresso, vanilla syrup all appear. Water isn't
    // in any Latte order so it shouldn't show up.
    const supplyIds = new Set(ingredients_used.map((i: { supply_id: string }) => i.supply_id));
    expect(supplyIds).toContain(s.supplyIds.milk);
    expect(supplyIds).toContain(s.supplyIds.espresso);
    expect(supplyIds.has(s.supplyIds.water)).toBe(false);
  });

  it('returns empty rows when no paid orders exist in the window', async () => {
    await placeAndPay(s, [
      { product_id: s.latteProductId, variant_id: s.latteSmallId, quantity: 1 },
    ]);
    // Window explicitly ends before the sale was paid.
    const res = await request(app)
      .get(
        `/api/v1/reports/product-analysis?product_id=${s.latteProductId}&from=2025-01-01T00:00:00Z&to=2025-06-01T00:00:00Z`,
      )
      .set(s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.variant_sales).toEqual([]);
    expect(res.body.data.modifier_usage).toEqual([]);
    expect(res.body.data.ingredients_used).toEqual([]);
  });

  it('returns 404 for a non-existent product', async () => {
    const res = await request(app)
      .get(
        `/api/v1/reports/product-analysis?product_id=00000000-0000-0000-0000-000000000000&from=2020-01-01&to=2030-01-01`,
      )
      .set(s.auth);
    expect(res.status).toBe(404);
  });
});

describe('Phase 9A.5 — GET /api/v1/orders/:id/ingredients', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('lists all supplies deducted for a paid order with quantity, unit cost, and total cost', async () => {
    const orderId = await placeAndPay(s, [
      {
        product_id: s.latteProductId,
        variant_id: s.latteLargeId,
        quantity: 1,
        modifier_ids: [s.extraShotModifierId],
      },
    ]);

    const res = await request(app)
      .get(`/api/v1/orders/${orderId}/ingredients`)
      .set(s.auth);
    expect(res.status).toBe(200);

    // 2 distinct supplies: milk + espresso. Espresso = 22g recipe + 9g extra shot
    // = 31g → 0.031 bags. Milk = 280/946 bottles.
    const ing = res.body.data.ingredients;
    const milk = ing.find((r: { supply_id: string }) => r.supply_id === s.supplyIds.milk);
    const espresso = ing.find((r: { supply_id: string }) => r.supply_id === s.supplyIds.espresso);
    expect(milk).toBeDefined();
    expect(espresso).toBeDefined();
    expect(espresso.quantity).toBe('0.031');
    expect(Number(milk.quantity)).toBeCloseTo(280 / 946, 4);

    // Every ingredient reports a positive unit_cost (WAC snapshotted on SALE).
    for (const row of ing) {
      expect(Number(row.unit_cost)).toBeGreaterThan(0);
      expect(Number(row.total_cost)).toBeGreaterThan(0);
    }

    // grand_total_cost equals the sum of per-row totals.
    const sum = ing.reduce((acc: number, r: { total_cost: string }) => acc + Number(r.total_cost), 0);
    expect(Number(res.body.data.grand_total_cost)).toBeCloseTo(sum, 4);
  });

  it('returns an empty list for an unpaid (OPEN) order — no SALE movements written yet', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/orders/${order.body.data.id}/ingredients`)
      .set(s.auth)
      .expect(200);
    expect(res.body.data.ingredients).toEqual([]);
    expect(res.body.data.grand_total_cost).toBe('0');
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await request(app)
      .get('/api/v1/orders/00000000-0000-0000-0000-000000000000/ingredients')
      .set(s.auth);
    expect(res.status).toBe(404);
  });
});
