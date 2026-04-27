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

// Minimal scenario for the waiter-pay PIN flow: one register opened by an
// admin (scenario.adminAuth), one PRODUCT-type Bottled Water with a supply, a
// deduction rule pointing at the bar so payment can finalize. Returns auth
// headers for ADMIN, CASHIER, and WAITER, plus the cashier's PIN so the
// waiter-pay tests can include it in the payment payload.
async function seed() {
  const [admin, cashier, waiter, supplier, barra, waterCat] = await Promise.all([
    makeUser({ role: 'ADMIN' }),
    makeUser({ role: 'CASHIER', pin: '5901' }),
    makeUser({ role: 'WAITER', pin: '5902' }),
    makeSupplier({ name: 'Distribuidora Test' }),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Bottled Drinks' }),
  ]);

  const adminAuth = authHeader(admin.id, 'ADMIN');
  const waiterAuth = authHeader(waiter.id, 'WAITER');

  const water = await makeSupply({
    category_id: waterCat.id,
    name: 'Bottled Water 500ml',
    base_unit: 'BOTTLE',
    content_per_unit: 500,
    content_unit: 'ML',
  });

  // Stock the bar so the deduction during payment doesn't go negative.
  const buy = await request(app)
    .post('/api/v1/purchases')
    .set(adminAuth)
    .send({
      supplier_id: supplier.id,
      storage_id: barra.id,
      date: '2026-04-21T00:00:00Z',
      items: [
        { supply_id: water.id, packaging_id: null, package_quantity: 24, price_per_package: 1200 },
      ],
    });
  expect(buy.status).toBe(201);
  await request(app).post(`/api/v1/purchases/${buy.body.data.id}/confirm`).set(adminAuth).expect(200);

  const product = await request(app)
    .post('/api/v1/products')
    .set(adminAuth)
    .send({ name: 'Bottled Water', type: 'PRODUCT', sell_price: 2500, supply_id: water.id });
  expect(product.status).toBe(201);

  const register = await request(app)
    .post('/api/v1/registers')
    .set(adminAuth)
    .send({ opening_amount: 50000 });
  expect(register.status).toBe(201);

  await request(app)
    .post('/api/v1/deduction-rules')
    .set(adminAuth)
    .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
    .expect(201);

  return {
    adminAuth,
    waiterAuth,
    cashierId: cashier.id,
    cashierPin: '5901',
    registerId: register.body.data.id as string,
    productId: product.body.data.id as string,
  };
}

async function openOrderWithWater(s: Awaited<ReturnType<typeof seed>>, auth: Record<string, string>) {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: s.registerId, order_type: 'DINE_IN' })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${order.body.data.id}/items`)
    .set(auth)
    .send({ product_id: s.productId, quantity: 1 })
    .expect(201);
  return order.body.data.id as string;
}

describe('Payment — waiter/barista must include cashier PIN; cashier+ does not', () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    s = await seed();
  });

  it('cashier+ pays without PIN — succeeds and approved_by_user_id is null (regression)', async () => {
    const orderId = await openOrderWithWater(s, s.adminAuth);
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.adminAuth)
      .send({ method: 'CASH', amount: 2500 });
    expect(pay.status).toBe(201);
    expect(pay.body.data.order.status).toBe('PAID');

    const stored = await prisma.payment.findFirstOrThrow({ where: { order_id: orderId } });
    expect(stored.approved_by_user_id).toBeNull();
  });

  it('waiter pays with valid cashier PIN — succeeds and approved_by_user_id = cashier', async () => {
    const orderId = await openOrderWithWater(s, s.waiterAuth);
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.waiterAuth)
      .send({ method: 'CASH', amount: 2500, pin: s.cashierPin });
    expect(pay.status).toBe(201);
    expect(pay.body.data.order.status).toBe('PAID');

    const stored = await prisma.payment.findFirstOrThrow({ where: { order_id: orderId } });
    expect(stored.approved_by_user_id).toBe(s.cashierId);
  });

  it('waiter pays without PIN — 403', async () => {
    const orderId = await openOrderWithWater(s, s.waiterAuth);
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.waiterAuth)
      .send({ method: 'CASH', amount: 2500 });
    expect(pay.status).toBe(403);
    expect(pay.body.error.message).toMatch(/PIN required/i);

    const count = await prisma.payment.count({ where: { order_id: orderId } });
    expect(count).toBe(0);
  });

  it('waiter pays with wrong PIN — 403', async () => {
    const orderId = await openOrderWithWater(s, s.waiterAuth);
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.waiterAuth)
      .send({ method: 'CASH', amount: 2500, pin: '0000' });
    expect(pay.status).toBe(403);
    expect(pay.body.error.message).toMatch(/Incorrect PIN/i);
  });

  it("waiter pays with another waiter's PIN — 403 (not cashier-grade)", async () => {
    const orderId = await openOrderWithWater(s, s.waiterAuth);
    const pay = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.waiterAuth)
      .send({ method: 'CASH', amount: 2500, pin: '5902' });
    expect(pay.status).toBe(403);
  });
});
