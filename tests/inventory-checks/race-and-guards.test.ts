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

interface Fixtures {
  userId: string;
  storageId: string;
  supplyId: string;
  auth: Record<string, string>;
}

async function setup(): Promise<Fixtures> {
  const [user, storage, category] = await Promise.all([
    makeUser(),
    makeStorage(),
    makeSupplyCategory(),
  ]);
  const supply = await makeSupply({ category_id: category.id, base_unit: 'KG' });
  await seedStock({
    supply_id: supply.id,
    storage_id: storage.id,
    quantity: 10,
    average_cost: 500,
  });
  return {
    userId: user.id,
    storageId: storage.id,
    supplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('completeInventoryCheck — concurrent claim', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('only one of two concurrent completes mutates stock', async () => {
    const created = await request(app)
      .post('/api/v1/inventory-checks')
      .set(f.auth)
      .send({
        storage_id: f.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    expect(created.status).toBe(201);
    const checkId = created.body.data.id as string;

    // Counter reports 7 instead of expected 10 → difference -3.
    await request(app)
      .patch(`/api/v1/inventory-checks/${checkId}/items`)
      .set(f.auth)
      .send({ items: [{ supply_id: f.supplyId, actual_qty: 7 }] })
      .expect(200);

    const [r1, r2] = await Promise.allSettled([
      request(app).post(`/api/v1/inventory-checks/${checkId}/complete`).set(f.auth),
      request(app).post(`/api/v1/inventory-checks/${checkId}/complete`).set(f.auth),
    ]);
    const statuses = [r1, r2].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    // Exactly one ADJUSTMENT movement.
    const adjustments = await prisma.stockMovement.findMany({
      where: { supply_id: f.supplyId, type: 'ADJUSTMENT' },
    });
    expect(adjustments).toHaveLength(1);

    // Stock is 7, not 4 (which would be the result of applying the diff twice).
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: f.supplyId, storage_id: f.storageId },
    });
    expect(stock.quantity.toString()).toBe('7');
  });
});

describe('createInventoryCheck — active storage guard', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('rejects if the storage is inactive', async () => {
    await prisma.storage.update({ where: { id: f.storageId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/inventory-checks')
      .set(f.auth)
      .send({
        storage_id: f.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/storage is inactive/i);
  });
});
