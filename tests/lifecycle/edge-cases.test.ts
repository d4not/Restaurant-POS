import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';
import { closeShift, openShift, seedLifecycle } from './_helpers.js';

const app = getTestApp();

// Boundary conditions across the shift / day / verification flows. Each test
// asserts a single failure mode so a regression points at exactly one rule.
describe('Edge cases — DailyReport close', () => {
  it('rejects with 409 when a shift for today is still OPEN', async () => {
    const s = await seedLifecycle(app);
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    // Leave the shift OPEN — close should refuse.
    await openShift(app, s.cashier.auth, 10000);

    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/still open/i);
  });

  it('rejects with 400 when no shift closed today', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('Edge cases — Provisional shift open', () => {
  it('rejects opening against a CLOSED parent shift with 409', async () => {
    const s = await seedLifecycle(app);
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parentId = await openShift(app, s.cashier.auth, 50000);
    // Close the parent first; the provisional contract requires the parent
    // to be OPEN at open-time.
    await closeShift(app, s.cashier.auth, parentId, 50000);

    const res = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parentId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/closed/i);
  });

  it('rejects opening against another PROVISIONAL with 400', async () => {
    const s = await seedLifecycle(app);
    const waiterA = await makeUser({ role: 'WAITER' });
    const waiterB = await makeUser({ role: 'WAITER' });
    const aAuth = authHeader(waiterA.id, 'WAITER');
    const bAuth = authHeader(waiterB.id, 'WAITER');

    const parentId = await openShift(app, s.cashier.auth, 50000);
    const provA = await request(app)
      .post('/api/v1/registers/provisional')
      .set(aAuth)
      .send({ parent_shift_id: parentId })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/registers/provisional')
      .set(bAuth)
      .send({ parent_shift_id: provA.body.data.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toMatch(/regular/i);
  });
});

describe('Edge cases — Provisional verify', () => {
  it('rejects verifying an already-verified shift with 409', async () => {
    const s = await seedLifecycle(app);
    const manager = await makeUser({ role: 'MANAGER', pin: '8421' });
    const managerAuth = authHeader(manager.id, 'MANAGER');
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parentId = await openShift(app, s.cashier.auth, 50000);
    const prov = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parentId })
      .expect(201);
    await closeShift(app, s.cashier.auth, prov.body.data.id, 0);

    // First verify succeeds.
    await request(app)
      .post(`/api/v1/registers/${prov.body.data.id}/verify`)
      .set(managerAuth)
      .send({ pin: '8421' })
      .expect(200);

    // Second verify on the same shift hits the write-once guard.
    const second = await request(app)
      .post(`/api/v1/registers/${prov.body.data.id}/verify`)
      .set(managerAuth)
      .send({ pin: '8421' });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/already verified/i);
  });
});
