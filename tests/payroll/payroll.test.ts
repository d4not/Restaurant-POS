import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

// Pick a known Monday so week boundaries stay deterministic regardless of when
// the tests run. 2026-04-20 is a Monday. Every attendance date in this file is
// an offset from this anchor.
// Anchor on a Monday that's entirely in the past relative to the test run so
// the future-date attendance guard doesn't fire. Mon 2026-04-13 → Sun 2026-04-19.
const WEEK_START_ISO = '2026-04-13';
const WEEK_START = new Date(`${WEEK_START_ISO}T00:00:00.000Z`);

function dayOffset(days: number): string {
  const d = new Date(WEEK_START);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makeEmployee(weeklySalary: number) {
  // Salaried employees are regular Users with weekly_salary set. Phase 8's
  // employees module wraps this, but tests can seed the raw row so we aren't
  // forced to go through the HTTP layer for setup.
  const base = await makeUser();
  return prisma.user.update({
    where: { id: base.id },
    data: { weekly_salary: weeklySalary, hire_date: new Date('2025-01-01T00:00:00Z') },
  });
}

async function logAttendance(
  auth: Record<string, string>,
  userId: string,
  date: string,
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'DAY_OFF',
  extra: { is_paid?: boolean; reason?: string } = {},
) {
  const res = await request(app)
    .post('/api/v1/attendance')
    .set(auth)
    .send({ user_id: userId, date, status, ...extra });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('POST /api/v1/payroll/generate', () => {
  let admin: { id: string };
  let auth: Record<string, string>;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
  });

  it('calculates gross/deductions/net per SPEC.md §8.4 formula', async () => {
    // $6000/week, 6 days expected, 1 unpaid absence →
    //   daily_rate = 6000 / 6 = 1000
    //   deductions = 1 * 1000 = 1000
    //   net        = 6000 - 1000 + 0 = 5000
    // Using centavos: 600000 weekly_salary → 100000 deduction → 500000 net.
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(1), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(2), 'ABSENT', { is_paid: false, reason: 'No-show' });
    await logAttendance(auth, emp.id, dayOffset(3), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(4), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(5), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(6), 'DAY_OFF');

    const res = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });

    expect(res.status).toBe(201);
    expect(res.body.data.generated).toBe(1);
    const [period] = res.body.data.items;
    expect(period.user_id).toBe(emp.id);
    expect(period.days_worked).toBe(5);
    expect(period.days_absent).toBe(1);
    expect(period.unpaid_absences).toBe(1);
    expect(period.paid_absences).toBe(0);
    expect(period.gross_pay).toBe('600000');
    expect(period.deductions).toBe('100000');
    expect(period.bonuses).toBe('0');
    expect(period.net_pay).toBe('500000');
    expect(period.status).toBe('DRAFT');
  });

  it('treats paid absences as non-deductions (worked week with sick day)', async () => {
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(1), 'ABSENT', { is_paid: true, reason: 'Sick' });
    await logAttendance(auth, emp.id, dayOffset(2), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(3), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(4), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(5), 'PRESENT');

    const res = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });

    const [period] = res.body.data.items;
    expect(period.paid_absences).toBe(1);
    expect(period.unpaid_absences).toBe(0);
    expect(period.deductions).toBe('0');
    expect(period.net_pay).toBe('600000');
  });

  it('counts LATE as worked', async () => {
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'LATE', { reason: 'Traffic' });
    const res = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    expect(res.body.data.items[0].days_worked).toBe(1);
  });

  it('rejects non-Monday week_start', async () => {
    // 2026-04-21 is a Tuesday.
    const res = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: '2026-04-21', days_expected: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('skips employees that already have a payroll for the same week', async () => {
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');

    const first = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    expect(first.body.data.generated).toBe(1);
    expect(first.body.data.skipped).toBe(0);

    const second = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    expect(second.body.data.generated).toBe(0);
    expect(second.body.data.skipped).toBe(1);

    // And the @@unique([user_id, week_start]) constraint is still holding.
    const count = await prisma.payrollPeriod.count({ where: { user_id: emp.id } });
    expect(count).toBe(1);
  });

  it('excludes inactive and non-salaried users', async () => {
    // Salaried but deactivated — should be skipped.
    const inactive = await makeEmployee(500000);
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });

    // No weekly_salary — should be skipped.
    await makeUser();

    // Active with salary — included.
    const active = await makeEmployee(600000);

    const res = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });

    expect(res.body.data.generated).toBe(1);
    expect(res.body.data.items[0].user_id).toBe(active.id);
  });
});

describe('PATCH /api/v1/payroll/:id — status transitions', () => {
  let admin: { id: string };
  let auth: Record<string, string>;
  let payrollId: string;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');
    const gen = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    payrollId = gen.body.data.items[0].id as string;
  });

  it('allows DRAFT → APPROVED, stamps approver, and freezes bonuses', async () => {
    // Update bonuses while still DRAFT.
    const bonusRes = await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ bonuses: 50000 });
    expect(bonusRes.status).toBe(200);
    expect(bonusRes.body.data.bonuses).toBe('50000');
    expect(bonusRes.body.data.net_pay).toBe('650000');

    const approveRes = await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'APPROVED' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');
    expect(approveRes.body.data.approver.id).toBe(admin.id);

    // Bonuses cannot be touched once approved.
    const lateBonus = await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ bonuses: 99999 });
    expect(lateBonus.status).toBe(409);
  });

  it('allows APPROVED → PAID but rejects PAID → APPROVED', async () => {
    await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'APPROVED' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'PAID' })
      .expect(200);

    const revert = await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'APPROVED' });
    expect(revert.status).toBe(409);
  });

  it('rejects skipping DRAFT → PAID', async () => {
    const res = await request(app)
      .patch(`/api/v1/payroll/${payrollId}`)
      .set(auth)
      .send({ status: 'PAID' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/v1/payroll/:id — attendance breakdown', () => {
  it('returns the attendance rows for the week alongside the summary', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const emp = await makeEmployee(600000);
    await logAttendance(auth, emp.id, dayOffset(0), 'PRESENT');
    await logAttendance(auth, emp.id, dayOffset(1), 'ABSENT', { is_paid: false });

    const gen = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    const id = gen.body.data.items[0].id as string;

    const detail = await request(app).get(`/api/v1/payroll/${id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.attendance).toHaveLength(2);
    const statuses = detail.body.data.attendance.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(['PRESENT', 'ABSENT']);
  });
});
