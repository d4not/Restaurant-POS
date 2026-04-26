import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
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

// A compact café scenario: one "Bar" storage (so deductions resolve via the
// register→storage rule), one simple DISH (Latte with a variant), one PRODUCT
// (Bottled Water) and a couple of modifiers — matching the Phase 7 spec's
// example flow. Returns every id the tests need so each case can stay terse.
interface Scenario {
  userId: string;
  auth: Record<string, string>;
  registerId: string;
  barraId: string;
  waterSupplyId: string;
  milkSupplyId: string;
  espressoSupplyId: string;
  almondSupplyId: string;
  waterProductId: string;
  latteProductId: string;
  latteVariantId: string;
  almondMilkModifierId: string;
  extraShotModifierId: string;
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

async function seedScenario(): Promise<Scenario> {
  const [user, supplier, barra, dairyCat, coffeeCat, waterCat] = await Promise.all([
    makeUser(),
    makeSupplier({ name: 'Distribuidora Café del Norte' }),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Dairy' }),
    makeSupplyCategory({ name: 'Coffee' }),
    makeSupplyCategory({ name: 'Bottled Drinks' }),
  ]);
  const auth = authHeader(user.id);

  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const almond = await makeSupply({
    category_id: dairyCat.id,
    name: 'Almond Milk 1L',
    base_unit: 'BOTTLE',
    content_per_unit: 1000,
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
    category_id: waterCat.id,
    name: 'Bottled Water 500ml',
    base_unit: 'BOTTLE',
    content_per_unit: 500,
    content_unit: 'ML',
  });

  await buyInto(auth, supplier.id, barra.id, milk.id, 10, 3000);
  await buyInto(auth, supplier.id, barra.id, almond.id, 5, 5000);
  await buyInto(auth, supplier.id, barra.id, espresso.id, 2, 40000);
  await buyInto(auth, supplier.id, barra.id, water.id, 24, 1200);

  const waterProduct = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({
      name: 'Bottled Water',
      type: 'PRODUCT',
      sell_price: 2500,
      supply_id: water.id,
    });
  expect(waterProduct.status).toBe(201);

  const category = await request(app)
    .post('/api/v1/product-categories')
    .set(auth)
    .send({ name: 'Hot Coffee' });
  expect(category.status).toBe(201);

  const latte = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: category.body.data.id,
    sell_price: 6500,
  });
  expect(latte.status).toBe(201);
  const latteProductId = latte.body.data.id as string;

  const variant = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Grande 16oz', sell_price: 6500 });
  expect(variant.status).toBe(201);
  const latteVariantId = variant.body.data.id as string;

  await request(app)
    .post(`/api/v1/recipes/variants/${latteVariantId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 200, unit: 'ml' },
        { supply_id: espresso.id, quantity: 18, unit: 'g' },
      ],
    })
    .expect(201);

  const milkGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Milk Type',
    min_selection: 0,
    max_selection: 1,
  });
  expect(milkGroup.status).toBe(201);
  const almondMod = await request(app)
    .post(`/api/v1/modifier-groups/${milkGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Almond Milk',
      extra_price: 1000,
      supply_id: almond.id,
      supply_quantity: 200,
      supply_unit: 'ml',
    });
  expect(almondMod.status).toBe(201);

  const extrasGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Extras',
    min_selection: 0,
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

  await request(app)
    .post(`/api/v1/products/${latteProductId}/modifier-groups`)
    .set(auth)
    .send({ modifier_group_id: milkGroup.body.data.id })
    .expect(201);
  await request(app)
    .post(`/api/v1/products/${latteProductId}/modifier-groups`)
    .set(auth)
    .send({ modifier_group_id: extrasGroup.body.data.id })
    .expect(201);

  // Open register — orders require an OPEN register for this user.
  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 50000 });
  expect(register.status).toBe(201);

  // Deduction rule: any order from this register deducts from Barra.
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
    .expect(201);

  return {
    userId: user.id,
    auth,
    registerId: register.body.data.id as string,
    barraId: barra.id,
    waterSupplyId: water.id,
    milkSupplyId: milk.id,
    espressoSupplyId: espresso.id,
    almondSupplyId: almond.id,
    waterProductId: waterProduct.body.data.id as string,
    latteProductId,
    latteVariantId,
    almondMilkModifierId: almondMod.body.data.id as string,
    extraShotModifierId: extraShot.body.data.id as string,
  };
}

function expectClose(actual: Decimal, expected: Decimal, tolerance = '0.0001'): void {
  const diff = actual.sub(expected).abs();
  expect(diff.lte(new Decimal(tolerance))).toBe(true);
}

describe('Full order lifecycle — open register → pay → deduct inventory', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('creates an order with auto-generated daily order_number starting at 1', async () => {
    const first = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' });
    expect(first.status).toBe(201);
    expect(first.body.data.order_number).toBe(1);
    expect(first.body.data.status).toBe('OPEN');
    expect(first.body.data.subtotal).toBe('0');
    expect(first.body.data.total).toBe('0');

    const second = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'TAKEOUT' });
    expect(second.body.data.order_number).toBe(2);
  });

  it('adds items with modifiers, snapshots prices, recalculates totals on each change', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    // 1× Latte Grande + Almond Milk ($6500 + $1000) = $7500
    const addLatte = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({
        product_id: s.latteProductId,
        variant_id: s.latteVariantId,
        quantity: 1,
        modifier_ids: [s.almondMilkModifierId],
      });
    expect(addLatte.status).toBe(201);
    expect(addLatte.body.data.subtotal).toBe('7500');

    // Add 2× Water ($2500 × 2 = $5000). Running subtotal = $12500.
    const addWater = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 2 });
    expect(addWater.status).toBe(201);
    expect(addWater.body.data.subtotal).toBe('12500');
    expect(addWater.body.data.total).toBe('12500');

    // Snapshots: the OrderItem's unit_price should equal the variant sell_price
    // captured at add time, not a live lookup.
    const items = addWater.body.data.items;
    const latteLine = items.find((i: { product_id: string }) => i.product_id === s.latteProductId);
    expect(latteLine.unit_price).toBe('6500');
    expect(latteLine.modifiers_price).toBe('1000');
    expect(latteLine.line_total).toBe('7500');
    expect(latteLine.modifiers).toHaveLength(1);
    expect(latteLine.modifiers[0].name).toBe('Almond Milk');
    expect(latteLine.modifiers[0].extra_price).toBe('1000');

    // Update quantity on the water line → line_total and order subtotal recompute.
    const waterLine = items.find((i: { product_id: string }) => i.product_id === s.waterProductId);
    const updated = await request(app)
      .patch(`/api/v1/orders/${orderId}/items/${waterLine.id}`)
      .set(s.auth)
      .send({ quantity: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.subtotal).toBe('15000');
    expect(updated.body.data.total).toBe('15000');
  });

  it('pays full cash with change, flips PAID, deducts inventory, updates register', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({
        product_id: s.latteProductId,
        variant_id: s.latteVariantId,
        quantity: 1,
        modifier_ids: [s.almondMilkModifierId, s.extraShotModifierId],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);

    // Total = 6500 + 1000 (almond) + 1500 (extra shot) + 2500 (water) = 11500.
    // Customer tenders 15000 cash → change 3500.
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 15000 });
    expect(pay.status).toBe(201);
    expect(pay.body.data.payment.change_amount).toBe('3500');
    expect(pay.body.data.order.status).toBe('PAID');
    expect(pay.body.data.deduction).not.toBeNull();
    expect(pay.body.data.deduction.warnings).toEqual([]);

    // 4 deductions: milk, almond, espresso, water (all landing at Barra per the rule).
    const supplyIds = new Set(pay.body.data.deduction.deductions.map((d: { supply_id: string }) => d.supply_id));
    expect(supplyIds).toContain(s.milkSupplyId);
    expect(supplyIds).toContain(s.almondSupplyId);
    expect(supplyIds).toContain(s.espressoSupplyId);
    expect(supplyIds).toContain(s.waterSupplyId);

    // Register expected_amount = opening(50000) + cash_net(15000 - 3500) = 61500.
    const register = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: s.registerId },
    });
    expect(register.expected_amount.toString()).toBe('61500');

    // Stock actually moved at Barra.
    const stocks = await prisma.storageStock.findMany({
      where: { storage_id: s.barraId },
    });
    const byId = new Map(stocks.map((st) => [st.supply_id, st]));
    // Water: 24 − 1 = 23 (PRODUCT path).
    expect(byId.get(s.waterSupplyId)!.quantity.toString()).toBe('23');
    // Milk: 10 − 200/946.
    expectClose(
      new Decimal(byId.get(s.milkSupplyId)!.quantity),
      new Decimal(10).sub(new Decimal(200).div(946)),
    );
    // Almond: 5 − 200/1000 = 4.8.
    expectClose(new Decimal(byId.get(s.almondSupplyId)!.quantity), new Decimal('4.8'));
    // Espresso: 2 − (18+9)/1000 = 1.973.
    expectClose(
      new Decimal(byId.get(s.espressoSupplyId)!.quantity),
      new Decimal(2).sub(new Decimal(27).div(1000)),
    );

    // SALE movements are attached to the order id.
    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', reference_id: orderId },
    });
    expect(movements).toHaveLength(4);
    for (const m of movements) {
      expect(m.reference_type).toBe('Order');
      expect(m.storage_id).toBe(s.barraId);
    }
  });
});

describe('Split payments — part cash + part card', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('partially pays cash, then finishes on card, settles on the final tender', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    // 4× Bottled Water = 4 × 2500 = 10000.
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 4 })
      .expect(201);

    // 1st tender: $40 cash (partial — no change).
    const cash = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 4000 });
    expect(cash.status).toBe(201);
    expect(cash.body.data.payment.change_amount).toBe('0');
    expect(cash.body.data.order.status).toBe('OPEN'); // still open — not fully paid
    expect(cash.body.data.deduction).toBeNull();

    // Register reflected the partial cash tender immediately.
    let register = await prisma.cashRegister.findUniqueOrThrow({ where: { id: s.registerId } });
    expect(register.expected_amount.toString()).toBe('54000'); // 50000 + 4000

    // 2nd tender: $60 card, must equal remaining exactly.
    const tooMuchCard = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 7000, reference: 'auth-xyz' });
    expect(tooMuchCard.status).toBe(400);

    const card = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 6000, reference: 'auth-xyz' });
    expect(card.status).toBe(201);
    expect(card.body.data.order.status).toBe('PAID');
    expect(card.body.data.deduction).not.toBeNull();

    // Register unaffected by the card tender — only cash moves expected_amount.
    register = await prisma.cashRegister.findUniqueOrThrow({ where: { id: s.registerId } });
    expect(register.expected_amount.toString()).toBe('54000');

    // Two payments on the order.
    const payments = await prisma.payment.findMany({ where: { order_id: orderId } });
    expect(payments).toHaveLength(2);

    // Water stock dropped by 4.
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: s.waterSupplyId, storage_id: s.barraId },
    });
    expect(stock.quantity.toString()).toBe('20');
  });
});

describe('Register close — expected_amount calculation with sales + cash movements', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('includes cash sales, cash change, and cash movements in the final expected_amount', async () => {
    // Sale 1: 1× Water, 2500, paid 3000 cash (500 change) → net cash +2500.
    const o1 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'TAKEOUT' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${o1.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${o1.body.data.id}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 3000 })
      .expect(201);

    // Sale 2: 2× Water, 5000, paid card → no effect on drawer.
    const o2 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'TAKEOUT' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${o2.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 2 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${o2.body.data.id}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 5000, reference: 'txn-123' })
      .expect(201);

    // Cash movements: +2000 tips in, -500 petty cash out.
    await request(app)
      .post(`/api/v1/registers/${s.registerId}/cash-movements`)
      .set(s.auth)
      .send({ type: 'CASH_IN', amount: 2000, reason: 'Tips' })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${s.registerId}/cash-movements`)
      .set(s.auth)
      .send({ type: 'CASH_OUT', amount: 500, reason: 'Napkins' })
      .expect(201);

    // Expected = 50000 opening + 2500 (cash sale net) + 2000 (in) − 500 (out)
    //         = 54000. Physical count 53800 → difference −200.
    const close = await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.auth)
      .send({ actual_amount: 53800 });
    expect(close.status).toBe(200);
    expect(close.body.data.expected_amount).toBe('54000');
    expect(close.body.data.difference).toBe('-200');
  });
});

describe('Guard rails — orders require open register, no double-pay, no cancel-paid', () => {
  async function freshUser() {
    const user = await makeUser();
    return { user, auth: authHeader(user.id) };
  }

  it('refuses to create an order without an OPEN register', async () => {
    const { auth } = await freshUser();
    // No register opened for this user. Create a register for someone else and
    // try to use that register_id — it exists but flipping it closed first
    // simulates the "closed register" case. Neither should let us create.
    const other = await makeUser();
    const otherAuth = authHeader(other.id);
    const otherReg = await request(app)
      .post('/api/v1/registers')
      .set(otherAuth)
      .send({ opening_amount: 1000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${otherReg.body.data.id}/close`)
      .set(otherAuth)
      .send({ actual_amount: 1000 })
      .expect(200);

    const res = await request(app)
      .post('/api/v1/orders')
      .set(auth)
      .send({ register_id: otherReg.body.data.id, order_type: 'DINE_IN' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 if register_id does not exist', async () => {
    const { auth } = await freshUser();
    const res = await request(app)
      .post('/api/v1/orders')
      .set(auth)
      .send({ register_id: '00000000-0000-0000-0000-000000000000', order_type: 'DINE_IN' });
    expect(res.status).toBe(400);
  });

  it('cannot pay an already-PAID order', async () => {
    const s = await seedScenario();
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 2500 })
      .expect(201);

    const second = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 100 });
    expect(second.status).toBe(409);
  });

  it('cannot cancel a PAID order', async () => {
    const s = await seedScenario();
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 2500 })
      .expect(201);

    const cancel = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .send({ reason: 'Customer asked', pin: '1234' });
    expect(cancel.status).toBe(409);
    // Inventory should still reflect the completed sale.
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: s.waterSupplyId, storage_id: s.barraId },
    });
    expect(stock.quantity.toString()).toBe('23');
  });

  it('cancels an OPEN order with no inventory effect', async () => {
    const s = await seedScenario();
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 5 })
      .expect(201);

    const cancel = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .send({ reason: 'Customer changed mind', pin: '1234' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');

    // Stock untouched.
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: s.waterSupplyId, storage_id: s.barraId },
    });
    expect(stock.quantity.toString()).toBe('24');
    // No SALE movement.
    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', reference_id: orderId },
    });
    expect(movements).toHaveLength(0);
  });

  it('refuses item add / update / remove on a CANCELLED order', async () => {
    const s = await seedScenario();
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .send({ reason: 'Test cancellation', pin: '1234' })
      .expect(200);

    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 });
    expect(add.status).toBe(409);
  });

  it('settles an order whose original register was closed by routing to the cashier’s new shift', async () => {
    const s = await seedScenario();
    // Order opened against the original register, items added, but never
    // settled — exactly the "left over from previous shift" case.
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);

    // Close the original register. The cashier counts the drawer with only
    // the opening float since no payment was rung up yet.
    await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.auth)
      .send({ actual_amount: 50000 })
      .expect(200);

    // Same cashier opens a new shift. Reapply the deduction rule for the
    // new register so inventory still lands at Barra.
    const newReg = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 30000 })
      .expect(201);
    const newRegisterId = newReg.body.data.id as string;
    await request(app)
      .post('/api/v1/deduction-rules')
      .set(s.auth)
      .send({ pos_register_id: newRegisterId, storage_id: s.barraId })
      .expect(201);

    // Pay the leftover order. The service should re-anchor it to the new
    // register and credit the cash to the active drawer, not the closed one.
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 2500 })
      .expect(201);
    expect(pay.body.data.order.status).toBe('PAID');

    const oldRegister = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: s.registerId },
    });
    expect(oldRegister.expected_amount.toString()).toBe('50000');

    const newRegister = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: newRegisterId },
    });
    // Opening float (30000) + cash payment (2500) = 32500.
    expect(newRegister.expected_amount.toString()).toBe('32500');

    const reanchored = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { register_id: true },
    });
    expect(reanchored.register_id).toBe(newRegisterId);
  });

  it('refuses payment when the original register is closed and the cashier has no open register', async () => {
    const s = await seedScenario();
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);

    await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.auth)
      .send({ actual_amount: 50000 })
      .expect(200);

    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 2500 });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe('CONFLICT');
  });
});

describe('Void / Restore — soft-delete for sent items + comanda update', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('hard-deletes an unsent line and excludes it from totals', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;

    const after = await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({})
      .expect(200);

    // Unsent → row is gone entirely; no tombstone left on the ticket.
    expect(after.body.data.items).toHaveLength(0);
    expect(after.body.data.total).toBe('0');
  });

  it('soft-deletes a sent line, leaves it on the ticket as a tombstone, excludes from totals', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 2 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;
    const lineTotal = add.body.data.total;
    expect(lineTotal).toBe('5000');

    // Send to kitchen flips sent_to_kitchen=true and stamps sent_at.
    const sent = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    expect(sent.body.data.printed_count).toBe(1);

    // Soft-delete requires a cashier PIN because the line is sent.
    const noPin = await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ reason: 'customer changed their mind' });
    expect(noPin.status).toBe(403);

    const voided = await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ pin: '1234', reason: 'customer changed their mind' })
      .expect(200);

    // Tombstone present, but totals zeroed.
    expect(voided.body.data.items).toHaveLength(1);
    const tombstone = voided.body.data.items[0];
    expect(tombstone.id).toBe(itemId);
    expect(tombstone.voided_at).toBeTruthy();
    expect(tombstone.void_reason).toBe('customer changed their mind');
    expect(tombstone.void_printed_at).toBeNull();
    expect(voided.body.data.total).toBe('0');
  });

  it('a follow-up Send to Kitchen prints a CORRECTION snapshot with the voided line struck through', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    // Two distinct lines so the correction has both an active item and a
    // voided tombstone — proves the snapshot includes both.
    const water = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1, notes: 'survives' })
      .expect(201);
    const voidWater = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1, notes: 'gets-voided' })
      .expect(201);
    const survivorId = water.body.data.items.find(
      (i: { notes: string | null }) => i.notes === 'survives',
    ).id as string;
    const voidId = voidWater.body.data.items.find(
      (i: { notes: string | null }) => i.notes === 'gets-voided',
    ).id as string;

    const first = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    expect(first.body.data.is_correction).toBe(false);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.voided_items).toHaveLength(0);

    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${voidId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const second = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);

    // CORRECTION snapshot: the survivor stays in items, the voided one
    // moves to voided_items. printed_count is total rows on the slip.
    expect(second.body.data.is_correction).toBe(true);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].id).toBe(survivorId);
    expect(second.body.data.voided_items).toHaveLength(1);
    expect(second.body.data.voided_items[0].id).toBe(voidId);
    expect(second.body.data.printed_count).toBe(2);

    // Third send with no further changes → silent no-op (no paper burned).
    const third = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    expect(third.body.data.printed_count).toBe(0);
    expect(third.body.data.items).toHaveLength(0);
    expect(third.body.data.voided_items).toHaveLength(0);
  });

  it('the correction snapshot keeps showing the voided tombstone even after a no-change send cycle', async () => {
    // The cocina is supposed to throw out the previous slip and replace it
    // with the latest correction. So a correction printed AFTER another
    // change must STILL include earlier voids — otherwise their replacement
    // slip would silently re-introduce items they were already told to drop.
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const a = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1, notes: 'A' })
      .expect(201);
    const aId = a.body.data.items.find(
      (i: { notes: string | null }) => i.notes === 'A',
    ).id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${aId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);
    // First correction surfaces the void.
    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);

    // Add a brand new item; the next correction must still mention the
    // earlier void so the replacement slip stays self-contained.
    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1, notes: 'B' })
      .expect(201);

    const corrected = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    expect(corrected.body.data.is_correction).toBe(true);
    expect(corrected.body.data.items).toHaveLength(1);
    expect(corrected.body.data.items[0].notes).toBe('B');
    // Earlier void is still on this correction slip — single source of truth.
    expect(corrected.body.data.voided_items).toHaveLength(1);
    expect(corrected.body.data.voided_items[0].id).toBe(aId);
  });

  it('restoring a void whose comanda was not yet printed brings the line straight back', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);

    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const restored = await request(app)
      .post(`/api/v1/orders/${orderId}/items/${itemId}/restore`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const item = restored.body.data.items.find(
      (i: { id: string }) => i.id === itemId,
    );
    expect(item.voided_at).toBeNull();
    // Kitchen wasn't notified of the void yet, so sent_to_kitchen stays true
    // — the kitchen still has the original ticket.
    expect(item.sent_to_kitchen).toBe(true);
    expect(restored.body.data.total).toBe('2500');
  });

  it('restoring a void whose comanda was already printed resets sent_to_kitchen so the kitchen sees a fresh order', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);
    // Print the void to flip void_printed_at.
    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);

    const restored = await request(app)
      .post(`/api/v1/orders/${orderId}/items/${itemId}/restore`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const item = restored.body.data.items.find(
      (i: { id: string }) => i.id === itemId,
    );
    expect(item.voided_at).toBeNull();
    // The kitchen was already told the line was gone, so the restore demotes
    // it back to "pending" — Send to Kitchen will pick it up again.
    expect(item.sent_to_kitchen).toBe(false);
    expect(item.sent_at).toBeNull();
    expect(item.void_printed_at).toBeNull();

    const reSent = await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    expect(reSent.body.data.items).toHaveLength(1);
    expect(reSent.body.data.items[0].id).toBe(itemId);
  });

  it('voided items are excluded from inventory deduction at payment time', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    // Two distinct lines so the void leaves a survivor to deduct.
    const water = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1, notes: 'keep' })
      .expect(201);
    const voidWater = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 3, notes: 'void' })
      .expect(201);
    const voidId = voidWater.body.data.items.find(
      (i: { quantity: number; notes: string | null }) =>
        i.notes === 'void',
    ).id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${voidId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    // total = surviving line ($2500). Pay it.
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 2500 })
      .expect(201);
    expect(pay.body.data.order.status).toBe('PAID');

    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', reference_id: orderId, supply_id: s.waterSupplyId },
    });
    // Single SALE movement of 1 bottle — the voided 3-bottle line never
    // touched inventory.
    expect(movements).toHaveLength(1);
    expect(new Decimal(movements[0].quantity).abs().toString()).toBe('1');
    void water; // silence unused warning while keeping the assignment self-documenting
  });

  it('restore is rejected without a cashier PIN', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const noPin = await request(app)
      .post(`/api/v1/orders/${orderId}/items/${itemId}/restore`)
      .set(s.auth)
      .send({});
    expect(noPin.status).toBe(403);
  });
});

describe('Tap-to-edit — variant + modifier changes via updateOrderItem', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('reshapes an unsent line: changes modifiers and reprices the line', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    // Plain Latte Grande (no modifiers) = $6500.
    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({
        product_id: s.latteProductId,
        variant_id: s.latteVariantId,
        quantity: 1,
      })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;
    expect(add.body.data.total).toBe('6500');

    // Edit: add Almond Milk (+$1000) → total 7500.
    const edited = await request(app)
      .patch(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ modifier_ids: [s.almondMilkModifierId] })
      .expect(200);
    expect(edited.body.data.total).toBe('7500');
    const line = edited.body.data.items.find(
      (i: { id: string }) => i.id === itemId,
    );
    expect(line.modifiers).toHaveLength(1);
    expect(line.modifiers[0].name).toBe('Almond Milk');
    expect(line.line_total).toBe('7500');
  });

  it('rejects edits to a voided line — must Restore first', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;
    const add = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.waterProductId, quantity: 1 })
      .expect(201);
    const itemId = add.body.data.items[0].id as string;
    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(s.auth)
      .expect(200);
    await request(app)
      .delete(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ pin: '1234' })
      .expect(200);

    const editVoided = await request(app)
      .patch(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ quantity: 5, pin: '1234' });
    expect(editVoided.status).toBe(409);
  });
});
