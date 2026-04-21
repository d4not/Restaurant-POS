import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { hashPassword } from '../../src/modules/auth/service.js';

const app = getTestApp();

let counter = 0;
const uniq = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;

async function seedLoginUser(
  overrides: { email?: string; password?: string; active?: boolean } = {},
) {
  const email = overrides.email ?? `${uniq('login')}@test.local`;
  const password = overrides.password ?? 'correct-horse-battery';
  const user = await prisma.user.create({
    data: {
      name: 'Login Tester',
      email,
      pin: '1234',
      password_hash: await hashPassword(password),
      role: 'ADMIN',
      active: overrides.active ?? true,
    },
  });
  return { user, email, password };
}

describe('Auth: POST /api/v1/auth/login', () => {
  it('returns a token + user on valid credentials', async () => {
    const { user, email, password } = await seedLoginUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.body.data.user).toMatchObject({
      id: user.id,
      email,
      name: 'Login Tester',
      role: 'ADMIN',
    });
    // The password_hash must NEVER leak to clients.
    expect(res.body.data.user.password_hash).toBeUndefined();
  });

  it('normalizes email casing + whitespace', async () => {
    const { email, password } = await seedLoginUser({ email: 'mixedcase@test.local' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `  ${email.toUpperCase()}  `, password });

    expect(res.status).toBe(200);
  });

  it('rejects wrong password with 401', async () => {
    const { email } = await seedLoginUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });

  it('rejects unknown email with the same 401 message (no enumeration leak)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid email or password/i);
  });

  it('rejects deactivated users', async () => {
    const { email, password } = await seedLoginUser({ active: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(res.status).toBe(401);
  });

  it('rejects missing fields with 422', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(422);
  });
});

describe('Auth: GET /api/v1/auth/me', () => {
  it('returns the current user when the bearer token is valid', async () => {
    const { user, email, password } = await seedLoginUser();

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    const token = login.body.data.token;

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: user.id,
      email,
      role: 'ADMIN',
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });
});
