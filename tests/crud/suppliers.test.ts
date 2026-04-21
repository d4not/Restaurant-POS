import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

describe('Suppliers CRUD', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
  });

  it('creates, reads, updates, lists, and soft-deletes', async () => {
    const createRes = await request(app)
      .post('/api/v1/suppliers')
      .set(auth)
      .send({
        name: 'Distribuidora Café del Norte',
        contact_name: 'Ana',
        phone: '5555-1212',
        credit_days: 15,
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id as string;
    expect(createRes.body.data.active).toBe(true);

    const getRes = await request(app).get(`/api/v1/suppliers/${id}`).set(auth);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Distribuidora Café del Norte');

    const updateRes = await request(app)
      .patch(`/api/v1/suppliers/${id}`)
      .set(auth)
      .send({ contact_name: 'Bernardo', credit_days: 30 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.contact_name).toBe('Bernardo');
    expect(updateRes.body.data.credit_days).toBe(30);

    const listRes = await request(app)
      .get('/api/v1/suppliers?search=café')
      .set(auth);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items).toHaveLength(1);

    const deleteRes = await request(app).delete(`/api/v1/suppliers/${id}`).set(auth);
    expect(deleteRes.status).toBe(204);
    const row = await prisma.supplier.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(false);

    const hiddenList = await request(app)
      .get('/api/v1/suppliers?active=true')
      .set(auth);
    expect(hiddenList.body.data.items).toHaveLength(0);
  });

  it('returns 404 for a non-existent supplier', async () => {
    const res = await request(app)
      .get('/api/v1/suppliers/00000000-0000-0000-0000-000000000000')
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/suppliers');
    expect(res.status).toBe(401);
  });

  it('rejects invalid UUID params with 422', async () => {
    const res = await request(app).get('/api/v1/suppliers/not-a-uuid').set(auth);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
