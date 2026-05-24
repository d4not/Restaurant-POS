import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

async function makeEmployee(weeklySalary = 600000) {
  const base = await makeUser();
  return prisma.user.update({
    where: { id: base.id },
    data: { weekly_salary: weeklySalary, name: 'Sched Employee' },
  });
}

describe('PUT /api/v1/schedule/users/:userId — replace week', () => {
  let admin: { id: string };
  let auth: Record<string, string>;
  let empId: string;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
    const emp = await makeEmployee();
    empId = emp.id;
  });

  it('atomically replaces the entire week and returns 7 cells', async () => {
    const slots = [
      { day_of_week: 0, start_minutes: 8 * 60, end_minutes: 14 * 60 },
      { day_of_week: 1, start_minutes: 8 * 60, end_minutes: 14 * 60 },
      { day_of_week: 5, start_minutes: 9 * 60, end_minutes: 15 * 60 },
    ];
    const res = await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(auth)
      .send({ slots });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.data[0]).toMatchObject({ start_minutes: 480, end_minutes: 840 });
    expect(res.body.data[1]).toMatchObject({ start_minutes: 480, end_minutes: 840 });
    expect(res.body.data[2]).toBeNull();
    expect(res.body.data[5]).toMatchObject({ start_minutes: 540, end_minutes: 900 });
    expect(res.body.data[6]).toBeNull();
  });

  it('clears days not included in the new payload', async () => {
    await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(auth)
      .send({
        slots: [
          { day_of_week: 0, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 1, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 2, start_minutes: 480, end_minutes: 840 },
        ],
      })
      .expect(200);

    // Now replace with only Saturday — Mon/Tue/Wed must disappear.
    const replaced = await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(auth)
      .send({
        slots: [{ day_of_week: 5, start_minutes: 600, end_minutes: 720 }],
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.filter((c: unknown) => c !== null)).toHaveLength(1);
    const count = await prisma.employeeScheduleSlot.count({
      where: { user_id: empId },
    });
    expect(count).toBe(1);
  });

  it('rejects end <= start with a Zod 422', async () => {
    const res = await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(auth)
      .send({
        slots: [{ day_of_week: 0, start_minutes: 600, end_minutes: 600 }],
      });
    expect(res.status).toBe(422);
  });

  it('rejects duplicate day_of_week entries', async () => {
    const res = await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(auth)
      .send({
        slots: [
          { day_of_week: 1, start_minutes: 480, end_minutes: 600 },
          { day_of_week: 1, start_minutes: 720, end_minutes: 840 },
        ],
      });
    expect(res.status).toBe(422);
  });

  it('404s for unknown user', async () => {
    const res = await request(app)
      .put('/api/v1/schedule/users/00000000-0000-0000-0000-000000000000')
      .set(auth)
      .send({ slots: [] });
    expect(res.status).toBe(404);
  });

  it('is forbidden for waiter/barista (writers gate)', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');
    const res = await request(app)
      .put(`/api/v1/schedule/users/${empId}`)
      .set(waiterAuth)
      .send({ slots: [] });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/schedule/users/:userId/days/:dayOfWeek — single day', () => {
  it('upserts an individual day without touching the rest', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const emp = await makeEmployee();
    await request(app)
      .put(`/api/v1/schedule/users/${emp.id}`)
      .set(auth)
      .send({
        slots: [
          { day_of_week: 0, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 1, start_minutes: 480, end_minutes: 840 },
        ],
      })
      .expect(200);

    // Update Tuesday only.
    const updated = await request(app)
      .patch(`/api/v1/schedule/users/${emp.id}/days/2`)
      .set(auth)
      .send({ start_minutes: 540, end_minutes: 900 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.start_minutes).toBe(540);

    const week = await request(app).get(`/api/v1/schedule/users/${emp.id}`).set(auth);
    expect(week.body.data[0]).toMatchObject({ start_minutes: 480 });
    expect(week.body.data[2]).toMatchObject({ start_minutes: 540 });
  });
});

describe('DELETE /api/v1/schedule/users/:userId/days/:dayOfWeek', () => {
  it('clears a single day', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const emp = await makeEmployee();
    await request(app)
      .put(`/api/v1/schedule/users/${emp.id}`)
      .set(auth)
      .send({
        slots: [
          { day_of_week: 0, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 1, start_minutes: 480, end_minutes: 840 },
        ],
      })
      .expect(200);

    await request(app)
      .delete(`/api/v1/schedule/users/${emp.id}/days/0`)
      .set(auth)
      .expect(204);

    const week = await request(app).get(`/api/v1/schedule/users/${emp.id}`).set(auth);
    expect(week.body.data[0]).toBeNull();
    expect(week.body.data[1]).not.toBeNull();
  });
});

describe('GET /api/v1/schedule — roster', () => {
  it('returns one row per active employee with weekly_salary set', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const a = await makeEmployee(500000);
    const b = await makeEmployee(700000);
    // Non-payroll user — must NOT appear.
    await makeUser({ role: 'BARISTA' });

    await request(app)
      .put(`/api/v1/schedule/users/${a.id}`)
      .set(auth)
      .send({
        slots: [{ day_of_week: 0, start_minutes: 480, end_minutes: 840 }],
      })
      .expect(200);

    const res = await request(app).get('/api/v1/schedule').set(auth);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { user_id: string }) => r.user_id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    // Each row carries a 7-cell week.
    for (const row of res.body.data) {
      expect(row.week).toHaveLength(7);
    }
    const aRow = res.body.data.find((r: { user_id: string }) => r.user_id === a.id);
    expect(aRow.week[0]).not.toBeNull();
    const bRow = res.body.data.find((r: { user_id: string }) => r.user_id === b.id);
    expect(bRow.week.every((c: unknown) => c === null)).toBe(true);
  });
});

describe('Schedule-derived days_expected on payroll generate', () => {
  // Monday of a stable week in the past. Matches WEEK_START_ISO used by the
  // payroll suite — keeps both tests' attendance windows aligned and avoids
  // clock-dependent flakes.
  const WEEK_START_ISO = '2026-04-20';

  it('uses count(active schedule slots) instead of the API default when a schedule exists', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const emp = await makeEmployee(600000);
    // 5 active days: daily_rate = 600000/5 = 120000, unpaid_absences=0 → net=600000.
    await request(app)
      .put(`/api/v1/schedule/users/${emp.id}`)
      .set(auth)
      .send({
        slots: [
          { day_of_week: 0, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 1, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 2, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 3, start_minutes: 480, end_minutes: 840 },
          { day_of_week: 4, start_minutes: 480, end_minutes: 840 },
        ],
      })
      .expect(200);

    // API default of 6 is ignored when the employee has a schedule.
    const gen = await request(app)
      .post('/api/v1/payroll/generate')
      .set(auth)
      .send({ week_start: WEEK_START_ISO, days_expected: 6 });
    expect(gen.status).toBe(201);
    const period = gen.body.data.items.find(
      (p: { user_id: string }) => p.user_id === emp.id,
    );
    expect(period).toBeDefined();
    expect(period.days_expected).toBe(5);
  });
});
