import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeStorage, makeSupply, makeSupplyCategory, seedStock } from '../helpers/factories.js';

const app = getTestApp();

// Pick a stable Monday in the past so attendance / payroll generation never
// trips the future-date guard.
const MONDAY_ISO = '2026-04-20';
const MONDAY_DATE = new Date(`${MONDAY_ISO}T00:00:00Z`);
function dayIso(offset: number): string {
  const d = new Date(MONDAY_DATE);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface Scenario {
  admin: { id: string };
  auth: Record<string, string>;
  registerId: string;
  productId: string;
  employees: { id: string; name: string }[];
}

async function seed(): Promise<Scenario> {
  const admin = await makeUser({ role: 'ADMIN', name: 'Pool Admin' });
  const auth = authHeader(admin.id, 'ADMIN');
  const storage = await makeStorage();
  const category = await makeSupplyCategory();
  const supply = await makeSupply({ category_id: category.id, base_unit: 'PIECE' });
  await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 1000, average_cost: 100 });
  await request(app).post('/api/v1/deduction-rules').set(auth).send({ storage_id: storage.id }).expect(201);
  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Latte', type: 'PRODUCT', sell_price: 5000, supply_id: supply.id })
    .expect(201);
  const reg = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 50000 })
    .expect(201);
  // Three salaried employees, each with weekly_salary set.
  const employees: { id: string; name: string }[] = [];
  for (const name of ['Alice', 'Bob', 'Carla']) {
    const u = await makeUser({ name, role: 'BARISTA' });
    await prisma.user.update({
      where: { id: u.id },
      data: { weekly_salary: 600000, name },
    });
    employees.push({ id: u.id, name });
  }
  return {
    admin,
    auth,
    registerId: reg.body.data.id as string,
    productId: product.body.data.id as string,
    employees,
  };
}

async function logCashTip(s: Scenario, tipCentavos: number): Promise<void> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(s.auth)
    .send({ register_id: s.registerId, order_type: 'DINE_IN' })
    .expect(201);
  const orderId = order.body.data.id as string;
  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(s.auth)
    .send({ product_id: s.productId, quantity: 1 })
    .expect(201);
  const paid = await request(app)
    .post(`/api/v1/orders/${orderId}/payments`)
    .set(s.auth)
    .send({ method: 'CASH', amount: 5000 + tipCentavos, tip_amount: tipCentavos })
    .expect(201);
  // Backdate the payment into the MONDAY_ISO week so it lands in that pool.
  // Without this the payment.created_at is "now" (test runtime), which is
  // not necessarily inside our chosen week — pool aggregation would miss it.
  const insideWeek = new Date(MONDAY_DATE);
  insideWeek.setUTCDate(insideWeek.getUTCDate() + 2); // Wednesday of that week
  insideWeek.setUTCHours(12, 0, 0, 0);
  await prisma.payment.update({
    where: { id: paid.body.data.payment.id as string },
    data: { created_at: insideWeek },
  });
}

async function markPresent(s: Scenario, userId: string, dayOffset: number): Promise<void> {
  await request(app)
    .post('/api/v1/attendance')
    .set(s.auth)
    .send({ user_id: userId, date: dayIso(dayOffset), status: 'PRESENT' })
    .expect(201);
}

async function generatePayroll(s: Scenario): Promise<void> {
  await request(app)
    .post('/api/v1/payroll/generate')
    .set(s.auth)
    .send({ week_start: MONDAY_ISO, days_expected: 6 })
    .expect(201);
}

describe('GET /api/v1/tips/pools/current', () => {
  it('lazily creates the OPEN pool for this Monday and aggregates collected tips', async () => {
    const s = await seed();
    await logCashTip(s, 1000);
    await logCashTip(s, 2000);

    // Use a date inside the same week as MONDAY_ISO so it lands on that pool.
    const res = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(2)}`)
      .set(s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.week_start.slice(0, 10)).toBe(MONDAY_ISO);
    expect(res.body.data.total_collected).toBe('3000');
    // Three eligible employees but none attended yet → all included=false.
    expect(res.body.data.allocations).toHaveLength(3);
    expect(res.body.data.allocations.every((a: { included: boolean }) => a.included === false)).toBe(true);
  });

  it('returns the same pool on the second call (no duplicate created)', async () => {
    const s = await seed();
    const first = await request(app).get(`/api/v1/tips/pools/current?date=${dayIso(0)}`).set(s.auth);
    const second = await request(app).get(`/api/v1/tips/pools/current?date=${dayIso(0)}`).set(s.auth);
    expect(first.body.data.id).toBe(second.body.data.id);
  });

  it('is forbidden for non-manager roles', async () => {
    await seed();
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');
    const res = await request(app).get('/api/v1/tips/pools/current').set(waiterAuth);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/tips/pools/:id/refresh — equal split among attendees', () => {
  it('divides total_collected equally among included (attended) employees', async () => {
    const s = await seed();
    await logCashTip(s, 3000);
    await logCashTip(s, 3000); // total 6000

    // Two of three employees attended.
    await markPresent(s, s.employees[0].id, 0);
    await markPresent(s, s.employees[1].id, 0);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;

    const refreshed = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/refresh`)
      .set(s.auth);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.total_collected).toBe('6000');

    const allocs = refreshed.body.data.allocations as Array<{
      user_id: string; included: boolean; base_amount: string; final_amount: string;
    }>;
    const alice = allocs.find((a) => a.user_id === s.employees[0].id)!;
    const carla = allocs.find((a) => a.user_id === s.employees[2].id)!;
    expect(alice.included).toBe(true);
    expect(alice.base_amount).toBe('3000');
    expect(alice.final_amount).toBe('3000');
    expect(carla.included).toBe(false);
    expect(carla.base_amount).toBe('0');
  });
});

describe('PATCH /api/v1/tips/pools/:id/allocations/:userId — manager toggles', () => {
  it('toggling include=false recomputes base_amount for the remaining attendees', async () => {
    const s = await seed();
    await logCashTip(s, 6000);
    for (const e of s.employees) await markPresent(s, e.id, 0);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;

    // Drop Carla — base_amount for Alice/Bob jumps from 2000 to 3000.
    const res = await request(app)
      .patch(`/api/v1/tips/pools/${poolId}/allocations/${s.employees[2].id}`)
      .set(s.auth)
      .send({ included: false });
    expect(res.status).toBe(200);
    const allocs = res.body.data.allocations as Array<{
      user_id: string; included: boolean; base_amount: string; final_amount: string;
    }>;
    const alice = allocs.find((a) => a.user_id === s.employees[0].id)!;
    expect(alice.base_amount).toBe('3000');
    expect(alice.final_amount).toBe('3000');
    const carla = allocs.find((a) => a.user_id === s.employees[2].id)!;
    expect(carla.included).toBe(false);
    expect(carla.final_amount).toBe('0');
  });

  it('override_amount supersedes base_amount and persists across refreshes', async () => {
    const s = await seed();
    await logCashTip(s, 6000);
    await markPresent(s, s.employees[0].id, 0);
    await markPresent(s, s.employees[1].id, 0);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;

    await request(app)
      .patch(`/api/v1/tips/pools/${poolId}/allocations/${s.employees[0].id}`)
      .set(s.auth)
      .send({ override_amount: 5000, note: 'extra for opening shift' })
      .expect(200);

    // Refresh — override sticks.
    const refreshed = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/refresh`)
      .set(s.auth);
    const alice = (refreshed.body.data.allocations as Array<{
      user_id: string; override_amount: string | null; final_amount: string; note: string | null;
    }>).find((a) => a.user_id === s.employees[0].id)!;
    expect(alice.override_amount).toBe('5000');
    expect(alice.final_amount).toBe('5000');
    expect(alice.note).toBe('extra for opening shift');
  });
});

describe('POST /api/v1/tips/pools/:id/close — distribute to payroll', () => {
  it('writes tips_amount + creates TIPS adjustment on every included payroll period', async () => {
    const s = await seed();
    await logCashTip(s, 6000); // total = 6000
    await markPresent(s, s.employees[0].id, 0);
    await markPresent(s, s.employees[1].id, 0);
    await generatePayroll(s);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;

    const closed = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/close`)
      .set(s.auth);
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');
    // 6000 / 2 = 3000 each = 6000 total distributed.
    expect(closed.body.data.total_distributed).toBe('6000');
    expect(closed.body.data.closer.id).toBe(s.admin.id);

    // Each attendee's payroll now carries a TIPS-sourced adjustment.
    const alicePeriod = await prisma.payrollPeriod.findFirst({
      where: { user_id: s.employees[0].id },
      include: { adjustments: true },
    });
    expect(alicePeriod?.tips_amount.toString()).toBe('3000');
    // bonuses mirror = adjustment_bonuses (0) + tips_amount (3000).
    expect(alicePeriod?.bonuses.toString()).toBe('3000');
    // net = 600000 (gross) + 3000 (tips) = 603000.
    expect(alicePeriod?.net_pay.toString()).toBe('603000');
    expect(alicePeriod?.adjustments).toHaveLength(1);
    expect(alicePeriod?.adjustments[0]).toMatchObject({
      type: 'BONUS',
      source_kind: 'TIPS',
    });

    // Carla didn't attend → no TIPS adjustment, tips_amount=0.
    const carlaPeriod = await prisma.payrollPeriod.findFirst({
      where: { user_id: s.employees[2].id },
      include: { adjustments: true },
    });
    expect(carlaPeriod?.tips_amount.toString()).toBe('0');
    expect(carlaPeriod?.adjustments).toHaveLength(0);
  });

  it('refuses to close when an included user has no payroll yet', async () => {
    const s = await seed();
    await logCashTip(s, 3000);
    await markPresent(s, s.employees[0].id, 0);
    // No generatePayroll call.

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;
    const res = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/close`)
      .set(s.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Generate payroll first/);
  });

  it('refuses to close when an included user has APPROVED payroll', async () => {
    const s = await seed();
    await logCashTip(s, 3000);
    await markPresent(s, s.employees[0].id, 0);
    await generatePayroll(s);

    // Approve Alice's payroll directly via the DB to skip having to add
    // adjustments / status PATCH flow noise in this test.
    const alice = await prisma.payrollPeriod.findFirst({
      where: { user_id: s.employees[0].id },
    });
    await prisma.payrollPeriod.update({
      where: { id: alice!.id },
      data: { status: 'APPROVED', approved_by: s.admin.id },
    });

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;
    const res = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/close`)
      .set(s.auth);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/tips/pools/:id/reopen', () => {
  it('reverses TIPS adjustments and unlocks the pool', async () => {
    const s = await seed();
    await logCashTip(s, 6000);
    await markPresent(s, s.employees[0].id, 0);
    await markPresent(s, s.employees[1].id, 0);
    await generatePayroll(s);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;
    await request(app).post(`/api/v1/tips/pools/${poolId}/close`).set(s.auth).expect(200);

    const reopen = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/reopen`)
      .set(s.auth);
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('OPEN');
    expect(reopen.body.data.total_distributed).toBe('0');

    const alice = await prisma.payrollPeriod.findFirst({
      where: { user_id: s.employees[0].id },
      include: { adjustments: true },
    });
    expect(alice?.tips_amount.toString()).toBe('0');
    expect(alice?.net_pay.toString()).toBe('600000');
    expect(alice?.adjustments).toHaveLength(0);
  });

  it('refuses to reopen when a downstream payroll is no longer DRAFT', async () => {
    const s = await seed();
    await logCashTip(s, 6000);
    await markPresent(s, s.employees[0].id, 0);
    await generatePayroll(s);

    const current = await request(app)
      .get(`/api/v1/tips/pools/current?date=${dayIso(0)}`)
      .set(s.auth);
    const poolId = current.body.data.id as string;
    await request(app).post(`/api/v1/tips/pools/${poolId}/close`).set(s.auth).expect(200);

    // Bump Alice's payroll past DRAFT.
    const alice = await prisma.payrollPeriod.findFirst({
      where: { user_id: s.employees[0].id },
    });
    await prisma.payrollPeriod.update({
      where: { id: alice!.id },
      data: { status: 'APPROVED', approved_by: s.admin.id },
    });

    const res = await request(app)
      .post(`/api/v1/tips/pools/${poolId}/reopen`)
      .set(s.auth);
    expect(res.status).toBe(409);
  });
});
