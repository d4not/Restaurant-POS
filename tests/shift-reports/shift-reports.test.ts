import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupply,
  makeSupplyCategory,
  makeUser,
  seedStock,
} from '../helpers/factories.js';

const app = getTestApp();

interface BasicSeed {
  cashier: { id: string; auth: Record<string, string> };
  productId: string;
  registerId: string;
}

// Minimal scenario: one cashier with an open register and one PRODUCT-typed
// item linked to a stocked supply. PRODUCT (vs DISH) avoids the recipe dance —
// payment deducts 1 supply unit per line. The point of these tests is the
// report layer, not the deduction engine, but a passing payment is the price
// of admission.
async function seedBasic(opening = 50000): Promise<BasicSeed> {
  const user = await makeUser({ role: 'CASHIER' });
  const auth = authHeader(user.id, 'CASHIER');

  // Storage + supply + stock so the PRODUCT can deduct on sale. The supply's
  // average_cost is irrelevant for the report — we're not asserting on COGS.
  const storage = await makeStorage({ name: 'Bar' });
  const category = await makeSupplyCategory({ name: 'Drinks' });
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Espresso shot',
    base_unit: 'PIECE',
  });
  await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 1000, average_cost: 100 });

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Espresso', type: 'PRODUCT', sell_price: 5000, supply_id: supply.id })
    .expect(201);

  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: opening })
    .expect(201);

  // Default deduction rule for this register → bar storage.
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: register.body.data.id, storage_id: storage.id })
    .expect(201);

  return {
    cashier: { id: user.id, auth },
    productId: product.body.data.id as string,
    registerId: register.body.data.id as string,
  };
}

async function payOrder(
  auth: Record<string, string>,
  registerId: string,
  productId: string,
  quantity: number,
  payAmount: number,
): Promise<string> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: registerId, order_type: 'DINE_IN' })
    .expect(201);
  const orderId = order.body.data.id as string;
  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(auth)
    .send({ product_id: productId, quantity })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${orderId}/payments`)
    .set(auth)
    .send({ method: 'CASH', amount: payAmount })
    .expect(201);
  return orderId;
}

describe('ShiftReport — generated automatically on closeRegister()', () => {
  let s: BasicSeed;
  beforeEach(async () => {
    s = await seedBasic();
  });

  it('creates a ShiftReport with accurate totals when a regular shift closes', async () => {
    // Two paid orders: 2× 5000 = 10000 with 10000 cash (no change), and
    // 1× 5000 with 6000 cash (1000 change).
    await payOrder(s.cashier.auth, s.registerId, s.productId, 2, 10000);
    await payOrder(s.cashier.auth, s.registerId, s.productId, 1, 6000);

    // Drawer count: opening(50000) + cash_net(10000 + 5000) = 65000.
    const close = await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.cashier.auth)
      .send({ actual_amount: 65000 })
      .expect(200);
    expect(close.body.data.expected_amount).toBe('65000');

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: s.registerId },
    });
    expect(report.user_id).toBe(s.cashier.id);
    expect(report.gross_sales).toBe(15000);
    expect(report.net_sales).toBe(15000); // no discounts
    expect(report.total_tickets).toBe(2);
    expect(report.avg_ticket).toBe(7500);
    expect(report.cash_sales).toBe(15000); // 16000 paid - 1000 change
    expect(report.card_sales).toBe(0);
    expect(report.opening_amount).toBe(50000);
    expect(report.expected_cash).toBe(65000);
    expect(report.actual_cash).toBe(65000);
    expect(report.cash_variance).toBe(0);
  });

  it('cash_variance equals actual_amount - expected_cash and matches CashRegister.difference', async () => {
    await payOrder(s.cashier.auth, s.registerId, s.productId, 1, 5000);

    // Customer paid 5000 cash; expected = 50000 + 5000 = 55000.
    // Cashier counts 54900 — short by 100 centavos.
    const close = await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.cashier.auth)
      .send({ actual_amount: 54900 })
      .expect(200);
    expect(close.body.data.difference).toBe('-100');

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: s.registerId },
    });
    expect(report.expected_cash).toBe(55000);
    expect(report.actual_cash).toBe(54900);
    expect(report.cash_variance).toBe(-100);
    expect(report.cash_variance).toBe(Number(close.body.data.difference));
  });

  it('counts cancelled orders as voids and excludes their totals from gross_sales', async () => {
    await payOrder(s.cashier.auth, s.registerId, s.productId, 1, 5000);

    // Open and immediately cancel — no items sent so a free-text reason is
    // sufficient (no PIN gate triggers).
    const open = await request(app)
      .post('/api/v1/orders')
      .set(s.cashier.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    const cancelOrderId = open.body.data.id as string;
    await request(app)
      .post(`/api/v1/orders/${cancelOrderId}/items`)
      .set(s.cashier.auth)
      .send({ product_id: s.productId, quantity: 1 })
      .expect(201);
    await request(app)
      .delete(`/api/v1/orders/${cancelOrderId}`)
      .set(s.cashier.auth)
      .send({ reason: 'customer changed mind, cancelling' })
      .expect(200);

    await request(app)
      .post(`/api/v1/registers/${s.registerId}/close`)
      .set(s.cashier.auth)
      .send({ actual_amount: 55000 })
      .expect(200);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: s.registerId },
    });
    expect(report.gross_sales).toBe(5000); // only the paid order
    expect(report.total_tickets).toBe(1);
    expect(report.void_count).toBe(1);
    expect(report.void_total).toBe(5000); // the cancelled order's total
  });
});

describe('GET /api/v1/shift-reports — list', () => {
  it('returns paginated results to MANAGER/ADMIN, ordered by closed_at desc', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    // Three sequential shifts to give us > 1 row in the list.
    for (let i = 0; i < 3; i++) {
      const cashier = await makeUser({ role: 'CASHIER' });
      const cashierAuth = authHeader(cashier.id, 'CASHIER');
      const open = await request(app)
        .post('/api/v1/registers')
        .set(cashierAuth)
        .send({ opening_amount: 1000 + i })
        .expect(201);
      await request(app)
        .post(`/api/v1/registers/${open.body.data.id}/close`)
        .set(cashierAuth)
        .send({ actual_amount: 1000 + i })
        .expect(200);
    }

    const list = await request(app)
      .get('/api/v1/shift-reports')
      .set(adminAuth)
      .expect(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.items).toHaveLength(3);
    expect(list.body.data.nextCursor).toBeNull();
    // Most recent first.
    const closedAts = list.body.data.items.map((r: { closed_at: string }) => r.closed_at);
    const sorted = [...closedAts].sort().reverse();
    expect(closedAts).toEqual(sorted);
  });

  it('rejects WAITER with 403', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const res = await request(app)
      .get('/api/v1/shift-reports')
      .set(authHeader(waiter.id, 'WAITER'));
    expect(res.status).toBe(403);
  });

});

describe('GET /api/v1/shift-reports/:id — detail', () => {
  it('returns the full report to a manager', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 10000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 10000 })
      .expect(200);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });

    const manager = await makeUser({ role: 'MANAGER' });
    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}`)
      .set(authHeader(manager.id, 'MANAGER'))
      .expect(200);
    expect(res.body.data.id).toBe(report.id);
    expect(res.body.data.cash_register).not.toBeNull();
    expect(Array.isArray(res.body.data.alerts)).toBe(true);
  });

  it('returns the report to its owner cashier', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 10000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 10000 })
      .expect(200);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });
    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}`)
      .set(cashierAuth)
      .expect(200);
    expect(res.body.data.id).toBe(report.id);
  });

  it('forbids a different cashier from reading the report', async () => {
    const ownerCashier = await makeUser({ role: 'CASHIER' });
    const ownerAuth = authHeader(ownerCashier.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(ownerAuth)
      .send({ opening_amount: 10000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(ownerAuth)
      .send({ actual_amount: 10000 })
      .expect(200);
    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });

    const otherCashier = await makeUser({ role: 'CASHIER' });
    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}`)
      .set(authHeader(otherCashier.id, 'CASHIER'));
    expect(res.status).toBe(403);
  });

  it('rejects a non-existent id with 404', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const res = await request(app)
      .get('/api/v1/shift-reports/00000000-0000-0000-0000-000000000000')
      .set(authHeader(admin.id, 'ADMIN'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/shift-reports/:id/print', () => {
  it('returns the simpler shift checklist HTML to MANAGER', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 50000 })
      .expect(200);
    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });

    const manager = await makeUser({ role: 'MANAGER' });
    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}/print`)
      .set(authHeader(manager.id, 'MANAGER'))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.text;
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/Shift Report/);
    // Mid-shift print sections from REPORTS-SPEC §5.5.
    expect(html).toMatch(/Cash in drawer/);
    expect(html).toMatch(/>Sales</);
    // Verification box and denomination breakdown are day-close-only —
    // never present on the per-shift print. (Note: the .sig-line CSS rule
    // is in the shared stylesheet but no element uses the class here.)
    expect(html).not.toMatch(/Verification/);
    expect(html).not.toMatch(/class="sig-line"/);
    // Checklist checkboxes still appear on the cash + payment lines.
    expect(html).toContain('[ ]');
    expect(html).toMatch(/window\.print\(\)/);
    expect(html).toMatch(/@media print/);
  });

  it('lets the owning cashier print their own shift', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 1000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 1000 })
      .expect(200);
    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });

    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}/print`)
      .set(cashierAuth);
    expect(res.status).toBe(200);
  });

  it('forbids a different cashier from printing the report', async () => {
    const owner = await makeUser({ role: 'CASHIER' });
    const ownerAuth = authHeader(owner.id, 'CASHIER');
    const reg = await request(app)
      .post('/api/v1/registers')
      .set(ownerAuth)
      .send({ opening_amount: 1000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(ownerAuth)
      .send({ actual_amount: 1000 })
      .expect(200);
    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: reg.body.data.id },
    });

    const other = await makeUser({ role: 'CASHIER' });
    const res = await request(app)
      .get(`/api/v1/shift-reports/${report.id}/print`)
      .set(authHeader(other.id, 'CASHIER'));
    expect(res.status).toBe(403);
  });

  it('rejects WAITER with 403 (route gate)', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const res = await request(app)
      .get('/api/v1/shift-reports/00000000-0000-0000-0000-000000000000/print')
      .set(authHeader(waiter.id, 'WAITER'));
    expect(res.status).toBe(403);
  });
});
