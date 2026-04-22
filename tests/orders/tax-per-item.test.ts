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

// Phase 9A.2 — tax moves from "recomputed from product at order-recalc time" to
// "snapshotted per OrderItem at add time". The snapshot guarantees that
// adjusting a tax rate tomorrow doesn't retroactively change yesterday's orders.
interface Seed {
  auth: Record<string, string>;
  registerId: string;
  ivaTaxId: string;
  taxedProductId: string;
  exemptProductId: string;
  supplyId: string;
}

async function buyStock(
  auth: Record<string, string>,
  supplierId: string,
  storageId: string,
  supplyId: string,
): Promise<void> {
  const draft = await request(app).post('/api/v1/purchases').set(auth).send({
    supplier_id: supplierId,
    storage_id: storageId,
    date: '2026-04-21T00:00:00Z',
    items: [
      { supply_id: supplyId, packaging_id: null, package_quantity: 50, price_per_package: 1000 },
    ],
  });
  expect(draft.status).toBe(201);
  await request(app)
    .post(`/api/v1/purchases/${draft.body.data.id}/confirm`)
    .set(auth)
    .expect(200);
}

async function seedBaseline(): Promise<Seed> {
  const [user, supplier, barra, cat] = await Promise.all([
    makeUser(),
    makeSupplier(),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory(),
  ]);
  const auth = authHeader(user.id);
  const supply = await makeSupply({ category_id: cat.id, name: 'Bottled Water', base_unit: 'BOTTLE' });
  await buyStock(auth, supplier.id, barra.id, supply.id);

  const tax = await request(app)
    .post('/api/v1/taxes')
    .set(auth)
    .send({ name: 'IVA 16%', rate: 16 });
  expect(tax.status).toBe(201);

  const taxed = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({
      name: 'Taxed Water',
      type: 'PRODUCT',
      sell_price: 1000,
      supply_id: supply.id,
      tax_id: tax.body.data.id,
    });
  expect(taxed.status).toBe(201);

  const exempt = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({
      name: 'Exempt Water',
      type: 'PRODUCT',
      sell_price: 1000,
      supply_id: supply.id,
    });
  expect(exempt.status).toBe(201);

  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 10000 })
    .expect(201);

  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
    .expect(201);

  return {
    auth,
    registerId: register.body.data.id as string,
    ivaTaxId: tax.body.data.id as string,
    taxedProductId: taxed.body.data.id as string,
    exemptProductId: exempt.body.data.id as string,
    supplyId: supply.id,
  };
}

describe('Phase 9A.2 — per-item tax snapshot on OrderItem', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedBaseline();
  });

  it('snapshots tax_rate on the item and computes tax_amount = line_total × rate', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const added = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 3 });
    expect(added.status).toBe(201);

    // line_total = 1000 × 3 = 3000, tax_amount = 3000 × 0.16 = 480.
    const item = added.body.data.items[0];
    expect(item.line_total).toBe('3000');
    expect(item.tax_rate).toBe('16');
    expect(item.tax_amount).toBe('480');
    expect(added.body.data.subtotal).toBe('3000');
    expect(added.body.data.tax_amount).toBe('480');
    expect(added.body.data.total).toBe('3480');
  });

  it('recomputes tax_amount when the item quantity changes', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const added = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 1 })
      .expect(201);
    const itemId = added.body.data.items[0].id as string;

    const updated = await request(app)
      .patch(`/api/v1/orders/${orderId}/items/${itemId}`)
      .set(s.auth)
      .send({ quantity: 5 });
    expect(updated.status).toBe(200);
    // line_total = 1000 × 5 = 5000, tax = 5000 × 0.16 = 800.
    const item = updated.body.data.items[0];
    expect(item.line_total).toBe('5000');
    expect(item.tax_amount).toBe('800');
    expect(updated.body.data.tax_amount).toBe('800');
    expect(updated.body.data.total).toBe('5800');
  });

  it('tax_amount is 0 for products without a tax_id', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const added = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.exemptProductId, quantity: 2 })
      .expect(201);

    const item = added.body.data.items[0];
    expect(item.tax_rate).toBe('0');
    expect(item.tax_amount).toBe('0');
    expect(added.body.data.tax_amount).toBe('0');
  });

  it('snapshot survives later edits to the Tax row — historical orders stay frozen', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    const added = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 1 })
      .expect(201);
    const itemId = added.body.data.items[0].id as string;

    // Bump IVA to 20% — purely a policy change that shouldn't rewrite history.
    await request(app)
      .patch(`/api/v1/taxes/${s.ivaTaxId}`)
      .set(s.auth)
      .send({ rate: 20 })
      .expect(200);

    const refetched = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(refetched.tax_rate.toString()).toBe('16');
    expect(refetched.tax_amount.toString()).toBe('160'); // 1000 × 0.16
  });

  it('Order.tax_amount is the sum of per-item tax snapshots across mixed taxed/exempt lines', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 2 }) // 2000 → tax 320
      .expect(201);
    const withBoth = await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.exemptProductId, quantity: 3 }) // 3000 → tax 0
      .expect(201);

    expect(withBoth.body.data.subtotal).toBe('5000');
    expect(withBoth.body.data.tax_amount).toBe('320');
    expect(withBoth.body.data.total).toBe('5320');
  });
});

// ============================================================================
// Audit gap coverage — tax behavior under modifiers, deactivation, discounts,
// item removal, and split payments. Orthogonal to the core snapshot tests.
// ============================================================================

async function seedForAudit(): Promise<Seed & { dairyModifierId: string }> {
  const base = await seedBaseline();

  // Add a simple ADD modifier that changes line_total — used by several tests
  // to verify modifiers flow into the tax calculation.
  const group = await request(app).post('/api/v1/modifier-groups').set(base.auth).send({
    name: 'Extras',
    type: 'ADD',
    max_selection: 3,
  });
  expect(group.status).toBe(201);
  const mod = await request(app)
    .post(`/api/v1/modifier-groups/${group.body.data.id}/modifiers`)
    .set(base.auth)
    .send({ name: 'Premium', extra_price: 500 });
  expect(mod.status).toBe(201);
  await request(app)
    .post(`/api/v1/products/${base.taxedProductId}/modifier-groups`)
    .set(base.auth)
    .send({ modifier_group_id: group.body.data.id })
    .expect(201);

  return { ...base, dairyModifierId: mod.body.data.id as string };
}

describe('Phase 9A audit — tax responds to modifier price and discount edits', () => {
  let s: Awaited<ReturnType<typeof seedForAudit>>;
  beforeEach(async () => {
    s = await seedForAudit();
  });

  it('modifier extra_price feeds into line_total and therefore into tax_amount', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const added = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({
        product_id: s.taxedProductId,
        quantity: 2,
        modifier_ids: [s.dairyModifierId],
      })
      .expect(201);

    // (1000 base + 500 mod) × 2 = 3000 line_total; tax = 3000 × 0.16 = 480.
    const item = added.body.data.items[0];
    expect(item.modifiers_price).toBe('500');
    expect(item.line_total).toBe('3000');
    expect(item.tax_amount).toBe('480');
    expect(added.body.data.tax_amount).toBe('480');
    expect(added.body.data.total).toBe('3480');
  });

  it('removing an item recalculates the order tax_amount from the surviving lines', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);

    const first = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 2 }) // 2000 / tax 320
      .expect(201);
    const second = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 1 }) // 1000 / tax 160
      .expect(201);
    expect(second.body.data.tax_amount).toBe('480');

    const firstItemId = first.body.data.items.find(
      (i: { quantity: number }) => i.quantity === 2,
    ).id as string;

    const after = await request(app)
      .delete(`/api/v1/orders/${order.body.data.id}/items/${firstItemId}`)
      .set(s.auth)
      .expect(200);
    // Only the qty=1 line remains. Tax snaps back to 160.
    expect(after.body.data.tax_amount).toBe('160');
    expect(after.body.data.total).toBe('1160');
  });

  it('applying a discount preserves tax_amount on the items and sets total = subtotal + tax − discount', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 10 }) // 10000 subtotal / tax 1600
      .expect(201);

    const discounted = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .send({ discount_amount: 2000, discount_reason: 'Loyalty' })
      .expect(200);

    expect(discounted.body.data.subtotal).toBe('10000');
    expect(discounted.body.data.tax_amount).toBe('1600');
    expect(discounted.body.data.discount_amount).toBe('2000');
    // subtotal + tax - discount = 10000 + 1600 - 2000 = 9600
    expect(discounted.body.data.total).toBe('9600');
  });

  it('a discount larger than subtotal + tax clamps the total to zero (never negative)', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 1 }) // 1000 + 160 tax = 1160 gross
      .expect(201);

    const discounted = await request(app)
      .patch(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .send({ discount_amount: 5000 })
      .expect(200);

    expect(discounted.body.data.subtotal).toBe('1000');
    expect(discounted.body.data.tax_amount).toBe('160');
    expect(discounted.body.data.total).toBe('0');
  });

  it('deactivating a tax does NOT rewrite already-added items — their snapshot still carries the original rate', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 1 })
      .expect(201);

    // Deactivate the tax — policy change, not a retroactive correction.
    await request(app)
      .patch(`/api/v1/taxes/${s.ivaTaxId}`)
      .set(s.auth)
      .send({ active: false })
      .expect(200);

    const reread = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set(s.auth)
      .expect(200);
    expect(reread.body.data.tax_amount).toBe('160');
    expect(reread.body.data.items[0].tax_rate).toBe('16');
  });

  it('split CASH + CARD payment settles the tax-inclusive total exactly', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const orderId = order.body.data.id as string;

    await request(app)
      .post(`/api/v1/orders/${orderId}/items`)
      .set(s.auth)
      .send({ product_id: s.taxedProductId, quantity: 5 }) // 5000 + 800 tax = 5800
      .expect(201);

    // Tender half in cash (partial, no change), then settle the remainder on card.
    const cashPay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 3000 });
    expect(cashPay.status).toBe(201);
    expect(cashPay.body.data.order.status).toBe('OPEN');

    const cardPay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 2800, reference: 'AUTH-999' });
    expect(cardPay.status).toBe(201);
    expect(cardPay.body.data.order.status).toBe('PAID');
    // Combined payments exactly cover subtotal + tax.
    expect(cardPay.body.data.order.total).toBe('5800');
  });
});

describe('Phase 9A.2 — Tax CRUD endpoints', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('creates, lists, gets, updates, and deletes a tax', async () => {
    const created = await request(app)
      .post('/api/v1/taxes')
      .set(auth)
      .send({ name: 'IVA 16%', rate: 16 });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('IVA 16%');

    const list = await request(app).get('/api/v1/taxes').set(auth).expect(200);
    expect(list.body.data).toHaveLength(1);

    const got = await request(app)
      .get(`/api/v1/taxes/${created.body.data.id}`)
      .set(auth)
      .expect(200);
    expect(got.body.data.name).toBe('IVA 16%');

    const updated = await request(app)
      .patch(`/api/v1/taxes/${created.body.data.id}`)
      .set(auth)
      .send({ rate: 8 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.rate.toString()).toBe('8');

    await request(app)
      .delete(`/api/v1/taxes/${created.body.data.id}`)
      .set(auth)
      .expect(204);
  });

  it('refuses to delete a tax that is still assigned to a product', async () => {
    const tax = await request(app)
      .post('/api/v1/taxes')
      .set(auth)
      .send({ name: 'IVA 16%', rate: 16 })
      .expect(201);

    const cat = await makeSupplyCategory();
    const supply = await makeSupply({ category_id: cat.id });
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Water',
        type: 'PRODUCT',
        sell_price: 1000,
        supply_id: supply.id,
        tax_id: tax.body.data.id,
      })
      .expect(201);

    const del = await request(app)
      .delete(`/api/v1/taxes/${tax.body.data.id}`)
      .set(auth);
    expect(del.status).toBe(409);
  });
});
