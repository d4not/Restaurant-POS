import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

interface Seed {
  userId: string;
  auth: Record<string, string>;
}

async function seed(): Promise<Seed> {
  const user = await makeUser();
  return { userId: user.id, auth: authHeader(user.id) };
}

describe('POST /api/v1/registers — open shift', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });

  it('opens a register with opening_amount and seeds expected_amount to match', async () => {
    const res = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 50000, notes: 'Morning shift' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.opening_amount).toBe('50000');
    expect(res.body.data.expected_amount).toBe('50000');
    expect(res.body.data.user_id).toBe(s.userId);
    expect(res.body.data.closed_at).toBeNull();
  });

  it('rejects opening a second register for the same user while one is OPEN', async () => {
    await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 50000 })
      .expect(201);

    const second = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 10000 });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('allows a second register once the first is closed', async () => {
    const first = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 50000 })
      .expect(201);

    await request(app)
      .post(`/api/v1/registers/${first.body.data.id}/close`)
      .set(s.auth)
      .send({ actual_amount: 50000 })
      .expect(200);

    const second = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 10000 });
    expect(second.status).toBe(201);
  });
});

describe('POST /api/v1/registers/:id/cash-movements', () => {
  let s: Seed;
  let registerId: string;

  beforeEach(async () => {
    s = await seed();
    const res = await request(app)
      .post('/api/v1/registers')
      .set(s.auth)
      .send({ opening_amount: 100000 });
    registerId = res.body.data.id as string;
  });

  it('adds a CASH_IN movement and increments expected_amount', async () => {
    const res = await request(app)
      .post(`/api/v1/registers/${registerId}/cash-movements`)
      .set(s.auth)
      .send({ type: 'CASH_IN', amount: 5000, reason: 'Tips added to drawer' });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe('5000');

    const register = await prisma.cashRegister.findUniqueOrThrow({ where: { id: registerId } });
    expect(register.expected_amount.toString()).toBe('105000');
  });

  it('adds a CASH_OUT movement and decrements expected_amount', async () => {
    await request(app)
      .post(`/api/v1/registers/${registerId}/cash-movements`)
      .set(s.auth)
      .send({ type: 'CASH_OUT', amount: 12000, reason: 'Petty cash for supplies' })
      .expect(201);

    const register = await prisma.cashRegister.findUniqueOrThrow({ where: { id: registerId } });
    expect(register.expected_amount.toString()).toBe('88000');
  });

  it('blocks cash movements on a CLOSED register', async () => {
    await request(app)
      .post(`/api/v1/registers/${registerId}/close`)
      .set(s.auth)
      .send({ actual_amount: 100000 })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/registers/${registerId}/cash-movements`)
      .set(s.auth)
      .send({ type: 'CASH_IN', amount: 1000, reason: 'Late deposit' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/registers/:id/close — expected_amount calculation', () => {
  it('computes expected = opening + cash-in - cash-out with no sales', async () => {
    const { userId, auth } = await seed();
    void userId;
    const open = await request(app)
      .post('/api/v1/registers')
      .set(auth)
      .send({ opening_amount: 50000 })
      .expect(201);
    const registerId = open.body.data.id as string;

    await request(app)
      .post(`/api/v1/registers/${registerId}/cash-movements`)
      .set(auth)
      .send({ type: 'CASH_IN', amount: 3000, reason: 'Tips' })
      .expect(201);
    await request(app)
      .post(`/api/v1/registers/${registerId}/cash-movements`)
      .set(auth)
      .send({ type: 'CASH_OUT', amount: 1500, reason: 'Supplies' })
      .expect(201);

    // Physical count: 51400 — short by 100 centavos.
    const close = await request(app)
      .post(`/api/v1/registers/${registerId}/close`)
      .set(auth)
      .send({ actual_amount: 51400 });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
    expect(close.body.data.expected_amount).toBe('51500');
    expect(close.body.data.actual_amount).toBe('51400');
    expect(close.body.data.difference).toBe('-100');
    expect(close.body.data.closed_at).not.toBeNull();
  });

  it('cannot close a register twice', async () => {
    const { auth } = await seed();
    const open = await request(app)
      .post('/api/v1/registers')
      .set(auth)
      .send({ opening_amount: 10000 })
      .expect(201);
    const id = open.body.data.id as string;

    await request(app)
      .post(`/api/v1/registers/${id}/close`)
      .set(auth)
      .send({ actual_amount: 10000 })
      .expect(200);

    const second = await request(app)
      .post(`/api/v1/registers/${id}/close`)
      .set(auth)
      .send({ actual_amount: 10000 });
    expect(second.status).toBe(409);
  });
});

describe('Cash register — close role gates', () => {
  it('barista CAN open a shift, but it is flagged provisional', async () => {
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');
    const res = await request(app)
      .post('/api/v1/registers')
      .set(baristaAuth)
      .send({ opening_amount: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.is_provisional).toBe(true);
  });

  it('cashier-opened shift is non-provisional', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const res = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.data.is_provisional).toBe(false);
  });

  it('barista cannot close a shift', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);

    const close = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(baristaAuth)
      .send({ actual_amount: 50000 });
    expect(close.status).toBe(403);
  });
});

describe('Provisional shift — verify flow', () => {
  it('blocks cash movements while provisional', async () => {
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(baristaAuth)
      .send({ opening_amount: 0 })
      .expect(201);

    const blocked = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/cash-movements`)
      .set(cashierAuth)
      .send({ type: 'CASH_IN', amount: 1000, reason: 'tips' });
    expect(blocked.status).toBe(409);
  });

  it('blocks close while provisional — must verify first', async () => {
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(baristaAuth)
      .send({ opening_amount: 0 })
      .expect(201);

    const blocked = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 0 });
    expect(blocked.status).toBe(409);
  });

  it('cashier verifies provisional → flag flips, diff is recorded, shift continues', async () => {
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(baristaAuth)
      .send({ opening_amount: 0 })
      .expect(201);
    const id = reg.body.data.id as string;

    // Verify with the actual count = expected (= 0 since no orders yet).
    const verify = await request(app)
      .post(`/api/v1/registers/${id}/verify-provisional`)
      .set(cashierAuth)
      .send({ actual_amount: 0 });
    expect(verify.status).toBe(200);
    expect(verify.body.data.is_provisional).toBe(false);
    expect(verify.body.data.provisional_verified_by_id).toBe(cashier.id);
    expect(verify.body.data.provisional_expected_amount).toBe('0');
    expect(verify.body.data.provisional_actual_amount).toBe('0');
    expect(verify.body.data.provisional_difference).toBe('0');
    expect(verify.body.data.status).toBe('OPEN');

    // After verify, cash movements unblock and the shift can close normally.
    await request(app)
      .post(`/api/v1/registers/${id}/cash-movements`)
      .set(cashierAuth)
      .send({ type: 'CASH_IN', amount: 1000, reason: 'tips' })
      .expect(201);

    const close = await request(app)
      .post(`/api/v1/registers/${id}/close`)
      .set(cashierAuth)
      .send({ actual_amount: 1000 });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
  });

  it('refuses verify on a non-provisional register (already verified)', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const cashierAuth = authHeader(cashier.id, 'CASHIER');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(cashierAuth)
      .send({ opening_amount: 50000 })
      .expect(201);

    const conflict = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/verify-provisional`)
      .set(cashierAuth)
      .send({ actual_amount: 50000 });
    expect(conflict.status).toBe(409);
  });

  it('barista cannot verify a provisional shift (role gate)', async () => {
    const barista = await makeUser({ role: 'BARISTA' });
    const baristaAuth = authHeader(barista.id, 'BARISTA');

    const reg = await request(app)
      .post('/api/v1/registers')
      .set(baristaAuth)
      .send({ opening_amount: 0 })
      .expect(201);

    const blocked = await request(app)
      .post(`/api/v1/registers/${reg.body.data.id}/verify-provisional`)
      .set(baristaAuth)
      .send({ actual_amount: 0 });
    expect(blocked.status).toBe(403);
  });
});
