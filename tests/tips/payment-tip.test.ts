import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeStorage, makeSupply, makeSupplyCategory, seedStock } from '../helpers/factories.js';

const app = getTestApp();

interface Scenario {
  auth: Record<string, string>;
  registerId: string;
  productId: string;
}

async function seed(): Promise<Scenario> {
  const cashier = await makeUser({ role: 'CASHIER' });
  const auth = authHeader(cashier.id, 'CASHIER');

  const storage = await makeStorage({ name: 'Bar' });
  const category = await makeSupplyCategory({ name: 'Drinks' });
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Espresso',
    base_unit: 'PIECE',
  });
  await seedStock({
    supply_id: supply.id,
    storage_id: storage.id,
    quantity: 1000,
    average_cost: 100,
  });
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ storage_id: storage.id })
    .expect(201);
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Espresso', type: 'PRODUCT', sell_price: 5000, supply_id: supply.id })
    .expect(201);
  const reg = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 50000 })
    .expect(201);
  return {
    auth,
    registerId: reg.body.data.id as string,
    productId: product.body.data.id as string,
  };
}

async function openOrderWithItem(s: Scenario, quantity = 1): Promise<string> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(s.auth)
    .send({ register_id: s.registerId, order_type: 'DINE_IN' })
    .expect(201);
  const id = order.body.data.id as string;
  await request(app)
    .post(`/api/v1/orders/${id}/items`)
    .set(s.auth)
    .send({ product_id: s.productId, quantity })
    .expect(201);
  return id;
}

async function getRegister(id: string) {
  const reg = await prisma.cashRegister.findUnique({ where: { id } });
  if (!reg) throw new Error('register not found');
  return reg;
}

describe('POST /api/v1/orders/:id/payments — tip handling (jar-aparte)', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seed();
  });

  it('CASH: tip stays in the jar (excluded from expected_amount, included in tips_collected)', async () => {
    // Sell one espresso at $50 (5000 centavos). Customer hands $80 ($50 sale + $30 tip).
    const orderId = await openOrderWithItem(s);
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 8000, tip_amount: 3000 });

    expect(res.status).toBe(201);
    expect(res.body.data.payment.amount).toBe('8000');
    expect(res.body.data.payment.tip_amount).toBe('3000');
    // Order side: $50 sale, $0 change (no overpay on the order portion).
    expect(res.body.data.payment.change_amount).toBe('0');
    expect(res.body.data.order.status).toBe('PAID');

    const reg = await getRegister(s.registerId);
    // Drawer only saw $50: opening 50000 + sale 5000 = 55000.
    expect(reg.expected_amount.toString()).toBe('55000');
    // Tip jar tracks $30 separately.
    expect(reg.tips_collected.toString()).toBe('3000');
  });

  it('CASH: overpayment on the order side still produces change, tip is preserved', async () => {
    // Sale $50, customer hands $100 ($60 toward sale + $40 tip) — order overpay is $10.
    const orderId = await openOrderWithItem(s);
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 10000, tip_amount: 4000 });

    expect(res.status).toBe(201);
    // orderPortion = 10000 - 4000 = 6000. Sale = 5000. Change = 1000.
    expect(res.body.data.payment.change_amount).toBe('1000');
    const reg = await getRegister(s.registerId);
    // Drawer: opening 50000 + (6000 - 1000) = 55000.
    expect(reg.expected_amount.toString()).toBe('55000');
    expect(reg.tips_collected.toString()).toBe('4000');
  });

  it('CARD: orderPortion (amount − tip) must equal remaining exactly', async () => {
    const orderId = await openOrderWithItem(s);
    // Try CARD $80 ($60 ≠ $50 sale). Reject.
    const bad = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 8000, tip_amount: 2000, reference: 'auth-1' });
    expect(bad.status).toBe(400);

    // Now $70 ($50 sale + $20 tip) — order portion 5000 matches.
    const ok = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 7000, tip_amount: 2000, reference: 'auth-2' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.order.status).toBe('PAID');
    const reg = await getRegister(s.registerId);
    // No cash hit the drawer.
    expect(reg.expected_amount.toString()).toBe('50000');
    // Tip jar tracks the card tip too — manager owes the jar from cash.
    expect(reg.tips_collected.toString()).toBe('2000');
  });

  it('rejects tip_amount > amount', async () => {
    const orderId = await openOrderWithItem(s);
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 5000, tip_amount: 6000 });
    expect(res.status).toBe(400);
  });

  it('rejects tip on PAYROLL_DEDUCT (no jar for deferred settlement)', async () => {
    // PAYROLL_DEDUCT requires an EMPLOYEE order; we don't need to fully wire
    // that here — even non-EMPLOYEE orders should reject the tip first.
    const orderId = await openOrderWithItem(s);
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'PAYROLL_DEDUCT', amount: 5000, tip_amount: 100 });
    expect(res.status).toBe(400);
  });

  it('zero tip behaves exactly like before (back-compat)', async () => {
    const orderId = await openOrderWithItem(s);
    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.data.payment.tip_amount).toBe('0');
    const reg = await getRegister(s.registerId);
    expect(reg.expected_amount.toString()).toBe('55000');
    expect(reg.tips_collected.toString()).toBe('0');
  });
});

describe('closeRegister — tips_collected snapshotted, expected_amount excludes tips', () => {
  it('aggregates tips across cash, card, and transfer payments at close', async () => {
    const s = await seed();

    // CASH order: $50 sale + $30 tip.
    const cashOrder = await openOrderWithItem(s);
    await request(app)
      .post(`/api/v1/orders/${cashOrder}/payments`)
      .set(s.auth)
      .send({ method: 'CASH', amount: 8000, tip_amount: 3000 })
      .expect(201);

    // CARD order: $50 sale + $20 tip.
    const cardOrder = await openOrderWithItem(s);
    await request(app)
      .post(`/api/v1/orders/${cardOrder}/payments`)
      .set(s.auth)
      .send({ method: 'CARD', amount: 7000, tip_amount: 2000, reference: 'tx-card' })
      .expect(201);

    // Close: expected = opening 50000 + 1 cash sale 5000 = 55000.
    // tips_collected = 3000 + 2000 = 5000.
    const close = await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.auth)
      .send({ actual_amount: 55000 })
      .expect(200);
    expect(close.body.data.expected_amount).toBe('55000');
    expect(close.body.data.tips_collected).toBe('5000');
    expect(close.body.data.difference).toBe('0');

    const shift = await prisma.shiftReport.findFirst({
      where: { cash_register_id: s.registerId },
    });
    expect(shift?.tips_collected).toBe(5000);
    // cash_sales is order-side only (no tip): just the one $50 sale.
    expect(shift?.cash_sales).toBe(5000);
  });
});
