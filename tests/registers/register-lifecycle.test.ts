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
