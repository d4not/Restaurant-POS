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

