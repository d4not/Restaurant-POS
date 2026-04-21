import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeStorage,
  makeSupplyCategory,
  makeSupply,
  seedStock,
} from '../helpers/factories.js';

const app = getTestApp();

describe('Storages CRUD', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
  });

  it('creates, updates, lists, and soft-deletes', async () => {
    const createRes = await request(app)
      .post('/api/v1/storages')
      .set(auth)
      .send({ name: 'Bodega', address: 'Back of house' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id as string;

    const updateRes = await request(app)
      .patch(`/api/v1/storages/${id}`)
      .set(auth)
      .send({ address: 'Kitchen annex' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.address).toBe('Kitchen annex');

    const listRes = await request(app)
      .get('/api/v1/storages?search=bodega')
      .set(auth);
    expect(listRes.body.data.items).toHaveLength(1);

    await request(app).delete(`/api/v1/storages/${id}`).set(auth).expect(204);
    const row = await prisma.storage.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(false);
  });

  it('PUT min_stock on a supply@storage via the nested stock endpoint', async () => {
    const [storage, category] = await Promise.all([
      makeStorage(),
      makeSupplyCategory(),
    ]);
    const supply = await makeSupply({ category_id: category.id, base_unit: 'KG' });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 3 });

    const res = await request(app)
      .patch(`/api/v1/storages/${storage.id}/stocks/${supply.id}`)
      .set(auth)
      .send({ min_stock: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.min_stock.toString()).toBe('1');
  });

  it('404 when updating a stock that does not exist', async () => {
    const storage = await makeStorage();
    const category = await makeSupplyCategory();
    const supply = await makeSupply({ category_id: category.id });
    const res = await request(app)
      .patch(`/api/v1/storages/${storage.id}/stocks/${supply.id}`)
      .set(auth)
      .send({ min_stock: 1 });
    expect(res.status).toBe(404);
  });
});
