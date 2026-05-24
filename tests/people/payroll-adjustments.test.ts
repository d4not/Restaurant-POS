import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

// Same WEEK_START as the main payroll suite — Monday 2026-04-20 — so all
// fixtures live in the past and the date validation never trips.
const WEEK_START_ISO = '2026-04-20';
const WEEK_START_DATE = new Date(`${WEEK_START_ISO}T00:00:00Z`);

async function makeEmployee(weeklySalary = 600000) {
  const base = await makeUser();
  return prisma.user.update({
    where: { id: base.id },
    data: { weekly_salary: weeklySalary, name: 'Adj Employee' },
  });
}

function dayOffset(n: number): string {
  const d = new Date(WEEK_START_DATE);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function logAttendance(
  auth: Record<string, string>,
  userId: string,
  date: string,
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'DAY_OFF',
  extras: { is_paid?: boolean; reason?: string } = {},
) {
  await request(app)
    .post('/api/v1/attendance')
    .set(auth)
    .send({ user_id: userId, date, status, ...extras })
    .expect(201);
}

async function generatePayroll(
  auth: Record<string, string>,
  userId: string,
  weeklySalary = 600000,
): Promise<string> {
  const emp = await makeEmployee(weeklySalary);
  // copy weekly salary onto the user we returned
  void emp;
  await logAttendance(auth, userId, dayOffset(0), 'PRESENT');
  const gen = await request(app)
    .post('/api/v1/payroll/generate')
    .set(auth)
    .send({ week_start: WEEK_START_ISO, days_expected: 6 });
  return gen.body.data.items.find(
    (p: { user_id: string }) => p.user_id === userId,
  ).id as string;
}

describe('POST /api/v1/payroll/:id/adjustments', () => {
  let admin: { id: string };
  let auth: Record<string, string>;
  let empId: string;
  let payrollId: string;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
    const emp = await makeEmployee(600000);
    empId = emp.id;
    await logAttendance(auth, empId, dayOffset(0), 'PRESENT');
    const gen = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    payrollId = gen.body.data.items.find(
      (p: { user_id: string }) => p.user_id === empId,
    ).id as string;
  });

  it('adds a BONUS adjustment, recomputes net_pay and the bonuses mirror', async () => {
    const res = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'Punctuality', amount: 25000 });

    expect(res.status).toBe(201);
    expect(res.body.data.adjustment_bonuses).toBe('25000');
    // No tips this week, so legacy bonuses mirror equals adjustment_bonuses.
    expect(res.body.data.bonuses).toBe('25000');
    // Gross 600000, no absences → net = 600000 + 25000 = 625000.
    expect(res.body.data.net_pay).toBe('625000');
    expect(res.body.data.adjustments).toHaveLength(1);
    expect(res.body.data.adjustments[0]).toMatchObject({
      type: 'BONUS',
      label: 'Punctuality',
      source_kind: 'MANUAL',
      creator: { id: admin.id },
    });
  });

  it('adds a DEDUCTION adjustment, recomputes net_pay and the deductions mirror', async () => {
    const res = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'DEDUCTION', label: 'Uniform replacement', amount: 18000 });

    expect(res.status).toBe(201);
    expect(res.body.data.adjustment_deductions).toBe('18000');
    expect(res.body.data.deductions).toBe('18000');
    expect(res.body.data.net_pay).toBe('582000');
  });

  it('combines multiple adjustments correctly in the formula', async () => {
    await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'Tips bonus', amount: 30000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'Performance', amount: 10000 })
      .expect(201);
    const res = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'DEDUCTION', label: 'Loan repayment', amount: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.adjustment_bonuses).toBe('40000');
    expect(res.body.data.adjustment_deductions).toBe('5000');
    // 600000 + 40000 − 5000 = 635000.
    expect(res.body.data.net_pay).toBe('635000');
  });

  it('refuses to add an adjustment once payroll is APPROVED', async () => {
    await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'APPROVED' })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'After approval', amount: 10000 });
    expect(res.status).toBe(409);
  });

  it('forbids non-manager roles (waiter/barista) from posting adjustments', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');
    const res = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(waiterAuth)
      .send({ type: 'BONUS', label: 'No way', amount: 1000 });
    expect(res.status).toBe(403);
  });

  it('rejects negative or zero amounts', async () => {
    const negative = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'bad', amount: -100 });
    expect(negative.status).toBe(422);
    const zero = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'bad', amount: 0 });
    expect(zero.status).toBe(422);
  });
});

describe('DELETE /api/v1/payroll/:id/adjustments/:adjustmentId', () => {
  let admin: { id: string };
  let auth: Record<string, string>;
  let payrollId: string;
  let adjustmentId: string;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');
    const gen = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    payrollId = gen.body.data.items.find(
      (p: { user_id: string }) => p.user_id === emp.id,
    ).id as string;
    const adj = await request(app)
      .post(`/api/v1/payroll/${payrollId}/adjustments`)
      .set(auth)
      .send({ type: 'BONUS', label: 'Punctuality', amount: 25000 });
    adjustmentId = adj.body.data.adjustments[0].id as string;
  });

  it('removes a MANUAL adjustment and recomputes net_pay', async () => {
    const res = await request(app)
      .delete(`/api/v1/payroll/${payrollId}/adjustments/${adjustmentId}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.adjustments).toHaveLength(0);
    expect(res.body.data.adjustment_bonuses).toBe('0');
    expect(res.body.data.net_pay).toBe('600000');
  });

  it('refuses to remove a TIPS-sourced adjustment', async () => {
    // Manufacture a TIPS-sourced row directly — the tip module isn't wired
    // until Phase 3, but the gate must already hold so consumers can rely on
    // it from day one.
    const tipsAdj = await prisma.payrollAdjustment.create({
      data: {
        payroll_period_id: payrollId,
        type: 'BONUS',
        label: 'Tips week of 2026-04-20',
        amount: 50000,
        source_kind: 'TIPS',
        source_id: null,
        created_by_user_id: admin.id,
      },
    });
    const res = await request(app)
      .delete(`/api/v1/payroll/${payrollId}/adjustments/${tipsAdj.id}`)
      .set(auth);
    expect(res.status).toBe(409);
  });

  it('refuses to remove when payroll is no longer DRAFT', async () => {
    await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'APPROVED' })
      .expect(200);
    const res = await request(app)
      .delete(`/api/v1/payroll/${payrollId}/adjustments/${adjustmentId}`)
      .set(auth);
    expect(res.status).toBe(409);
  });
});
