import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

describe('POST /api/v1/registers/provisional — open a provisional shift', () => {
  it('opens against an OPEN REGULAR parent and returns the new register', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const waiter = await makeUser({ role: 'WAITER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent.body.data.id });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('PROVISIONAL');
    // legacy `kind` column is mirrored so the existing payment / takeout
    // codepaths still see the provisional marker.
    expect(res.body.data.kind).toBe('PROVISIONAL');
    expect(res.body.data.parent_shift_id).toBe(parent.body.data.id);
    expect(res.body.data.opening_amount).toBe('0');
    expect(res.body.data.requires_verification).toBe(true);
    expect(res.body.data.user_id).toBe(waiter.id);
    expect(res.body.data.status).toBe('OPEN');
  });

  it('rejects when parent shift is CLOSED (409)', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const waiter = await makeUser({ role: 'WAITER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${parent.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 50000 })
      .expect(200);

    const res = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent.body.data.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects when parent shift is itself a PROVISIONAL (400)', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const waiterA = await makeUser({ role: 'WAITER' });
    const waiterB = await makeUser({ role: 'WAITER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const aAuth = authHeader(waiterA.id, 'WAITER');
    const bAuth = authHeader(waiterB.id, 'WAITER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);

    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(aAuth)
      .send({ parent_shift_id: parent.body.data.id })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/registers/provisional')
      .set(bAuth)
      .send({ parent_shift_id: provisional.body.data.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toMatch(/regular/i);
  });
});

describe('POST /api/v1/registers/:id/verify', () => {
  async function openAndCloseProvisional() {
    const cashier = await makeUser({ role: 'CASHIER' });
    const waiter = await makeUser({ role: 'WAITER' });
    const manager = await makeUser({ role: 'MANAGER', pin: '8421' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const waiterAuth = authHeader(waiter.id, 'WAITER');
    const managerAuth = authHeader(manager.id, 'MANAGER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);
    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent.body.data.id })
      .expect(201);

    return { cashier, manager, cashierAuth, managerAuth, provisionalId: provisional.body.data.id as string };
  }

  it('verifies a CLOSED provisional with a valid MANAGER PIN', async () => {
    const { manager, cashierAuth, managerAuth, provisionalId } = await openAndCloseProvisional();

    await request(app)
      .post(`/api/v1/registers/${provisionalId}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 1500 })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/registers/${provisionalId}/verify`)
      .set(managerAuth)
      .send({ pin: '8421', notes: 'Counted; cash matches' });

    expect(res.status).toBe(200);
    expect(res.body.data.verified_by_id).toBe(manager.id);
    expect(res.body.data.verified_at).not.toBeNull();
    expect(res.body.data.verification_notes).toBe('Counted; cash matches');
  });

  it('rejects verifying an OPEN provisional (409)', async () => {
    const { managerAuth, provisionalId } = await openAndCloseProvisional();

    const res = await request(app)
      .post(`/api/v1/registers/${provisionalId}/verify`)
      .set(managerAuth)
      .send({ pin: '8421' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/closed/i);
  });

  it('rejects when PIN does not match a manager/admin (403)', async () => {
    // Cashier PIN must NOT pass the manager-only step-up — verifying is a
    // manager+ action even if the cashier closed the shift moments earlier.
    const cashier = await makeUser({ role: 'CASHIER', pin: '7777' });
    const waiter = await makeUser({ role: 'WAITER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);
    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent.body.data.id })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${provisional.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 0 })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/registers/${provisional.body.data.id}/verify`)
      .set(cashierAuth)
      .send({ pin: '7777' });
    expect(res.status).toBe(403);
  });
});

describe('Provisional restrictions on existing services', () => {
  async function openProvisional() {
    const cashier = await makeUser({ role: 'CASHIER' });
    const waiter = await makeUser({ role: 'WAITER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);
    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent.body.data.id })
      .expect(201);

    return {
      cashierAuth,
      waiterAuth,
      parentId: parent.body.data.id as string,
      provisionalId: provisional.body.data.id as string,
    };
  }

  it('blocks cash movements on a provisional shift (403)', async () => {
    const { cashierAuth, provisionalId } = await openProvisional();
    const res = await request(app)
      .post(`/api/v1/registers/${provisionalId}/cash-movements`)
      .set(cashierAuth)
      .send({ type: 'CASH_IN', amount: 1000, reason: 'tips drop' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toMatch(/provisional/i);
  });

  it('blocks discount changes on an order tied to a provisional shift (403)', async () => {
    const { cashierAuth, waiterAuth, provisionalId } = await openProvisional();

    const order = await request(app)
      .post('/api/v1/orders')
      .set(waiterAuth)
      .send({ register_id: provisionalId, order_type: 'DINE_IN' })
      .expect(201);

    const res = await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(cashierAuth)
      .send({ discount_amount: 1000, discount_reason: 'comp' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toMatch(/provisional/i);
  });
});
