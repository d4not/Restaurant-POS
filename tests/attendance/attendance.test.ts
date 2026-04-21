import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

async function makeEmployee(weeklySalary = 500000) {
  const base = await makeUser();
  return prisma.user.update({
    where: { id: base.id },
    data: { weekly_salary: weeklySalary },
  });
}

describe('POST /api/v1/attendance', () => {
  let admin: { id: string };
  let auth: Record<string, string>;

  beforeEach(async () => {
    admin = await makeUser();
    auth = authHeader(admin.id);
  });

  it('creates an attendance record and stamps recorder', async () => {
    const emp = await makeEmployee();
    const res = await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({ user_id: emp.id, date: '2026-04-20', status: 'PRESENT' });

    expect(res.status).toBe(201);
    expect(res.body.data.user_id).toBe(emp.id);
    expect(res.body.data.status).toBe('PRESENT');
    expect(res.body.data.recorded_by).toBe(admin.id);
    expect(res.body.data.is_paid).toBe(true);
  });

  it('upserts the second record for the same user+date (no duplicate key error)', async () => {
    const emp = await makeEmployee();
    await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({ user_id: emp.id, date: '2026-04-20', status: 'PRESENT' })
      .expect(201);

    // Same date again — re-logs "actually sick" over the PRESENT row.
    const updated = await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({ user_id: emp.id, date: '2026-04-20', status: 'ABSENT', is_paid: false, reason: 'Sick' });
    expect(updated.status).toBe(201);
    expect(updated.body.data.status).toBe('ABSENT');
    expect(updated.body.data.is_paid).toBe(false);

    // @@unique([user_id, date]) still holds — only one row exists.
    const count = await prisma.attendance.count({
      where: { user_id: emp.id, date: new Date('2026-04-20T00:00:00Z') },
    });
    expect(count).toBe(1);
  });

  it('rejects a future date', async () => {
    const emp = await makeEmployee();
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const res = await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({
        user_id: emp.id,
        date: future.toISOString().slice(0, 10),
        status: 'PRESENT',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects logging for an inactive employee', async () => {
    const emp = await makeEmployee();
    await prisma.user.update({ where: { id: emp.id }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({ user_id: emp.id, date: '2026-04-20', status: 'PRESENT' });
    expect(res.status).toBe(400);
  });

  it('forces is_paid=true for non-ABSENT statuses regardless of payload', async () => {
    const emp = await makeEmployee();
    const res = await request(app)
      .post('/api/v1/attendance')
      .set(auth)
      .send({ user_id: emp.id, date: '2026-04-20', status: 'PRESENT', is_paid: false });
    expect(res.body.data.is_paid).toBe(true);
  });
});

describe('GET /api/v1/attendance — filters', () => {
  it('filters by user_id, status, and date range', async () => {
    const admin = await makeUser();
    const auth = authHeader(admin.id);
    const a = await makeEmployee();
    const b = await makeEmployee();

    await request(app).post('/api/v1/attendance').set(auth)
      .send({ user_id: a.id, date: '2026-04-20', status: 'PRESENT' }).expect(201);
    await request(app).post('/api/v1/attendance').set(auth)
      .send({ user_id: a.id, date: '2026-04-21', status: 'ABSENT', is_paid: false }).expect(201);
    await request(app).post('/api/v1/attendance').set(auth)
      .send({ user_id: b.id, date: '2026-04-20', status: 'PRESENT' }).expect(201);

    const byUser = await request(app).get(`/api/v1/attendance?user_id=${a.id}`).set(auth);
    expect(byUser.body.data.items).toHaveLength(2);

    const byStatus = await request(app).get('/api/v1/attendance?status=ABSENT').set(auth);
    expect(byStatus.body.data.items).toHaveLength(1);
    expect(byStatus.body.data.items[0].user_id).toBe(a.id);

    const byRange = await request(app)
      .get('/api/v1/attendance?from=2026-04-21&to=2026-04-21')
      .set(auth);
    expect(byRange.body.data.items).toHaveLength(1);
  });
});
