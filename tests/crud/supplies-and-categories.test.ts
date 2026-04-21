import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeSupplyCategory, makeSupply } from '../helpers/factories.js';

const app = getTestApp();

describe('SupplyCategory CRUD', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
  });

  it('creates, lists, updates, and deletes', async () => {
    const create = await request(app)
      .post('/api/v1/supply-categories')
      .set(auth)
      .send({ name: 'Dairy' });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const list = await request(app).get('/api/v1/supply-categories?search=dairy').set(auth);
    expect(list.body.data.items).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/supply-categories/${id}`)
      .set(auth)
      .send({ description: 'milk etc' });
    expect(update.status).toBe(200);

    await request(app).delete(`/api/v1/supply-categories/${id}`).set(auth).expect(204);
  });

  it('rejects deletion while supplies still reference the category', async () => {
    const cat = await makeSupplyCategory();
    await makeSupply({ category_id: cat.id });
    const res = await request(app).delete(`/api/v1/supply-categories/${cat.id}`).set(auth);
    expect(res.status).toBe(409);
  });
});

describe('Supply CRUD', () => {
  let auth: Record<string, string>;
  let categoryId: string;
  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
    categoryId = (await makeSupplyCategory()).id;
  });

  it('creates, reads, updates, and soft-deletes', async () => {
    const create = await request(app)
      .post('/api/v1/supplies')
      .set(auth)
      .send({
        name: 'Whole Milk 946ml',
        category_id: categoryId,
        base_unit: 'BOTTLE',
        content_per_unit: 946,
        content_unit: 'ML',
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    await request(app).get(`/api/v1/supplies/${id}`).set(auth).expect(200);

    const update = await request(app)
      .patch(`/api/v1/supplies/${id}`)
      .set(auth)
      .send({ name: 'Whole Milk' });
    expect(update.status).toBe(200);
    expect(update.body.data.name).toBe('Whole Milk');

    await request(app).delete(`/api/v1/supplies/${id}`).set(auth).expect(204);

    const row = await prisma.supply.findUniqueOrThrow({ where: { id } });
    expect(row.deleted_at).not.toBeNull();
    expect(row.active).toBe(false);

    // GET after soft-delete → 404 unless include_deleted is used
    await request(app).get(`/api/v1/supplies/${id}`).set(auth).expect(404);
  });

  it('excludes soft-deleted supplies from list by default', async () => {
    const live = await makeSupply({ category_id: categoryId, name: 'Live' });
    const dead = await makeSupply({ category_id: categoryId, name: 'Dead' });
    await prisma.supply.update({ where: { id: dead.id }, data: { deleted_at: new Date() } });

    const listRes = await request(app).get('/api/v1/supplies').set(auth);
    const names = listRes.body.data.items.map((i: { name: string }) => i.name);
    expect(names).toContain('Live');
    expect(names).not.toContain('Dead');

    const withDeleted = await request(app)
      .get('/api/v1/supplies?include_deleted=true')
      .set(auth);
    const allNames = withDeleted.body.data.items.map((i: { name: string }) => i.name);
    expect(allNames).toContain('Live');
    expect(allNames).toContain('Dead');
    expect(live.id).toBeTruthy();
  });

  it('rejects a supply with a missing category_id', async () => {
    const res = await request(app)
      .post('/api/v1/supplies')
      .set(auth)
      .send({
        name: 'Whatever',
        category_id: '00000000-0000-0000-0000-000000000000',
        base_unit: 'KG',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/category/i);
  });
});
