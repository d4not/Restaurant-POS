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
  fromId: string;
  toId: string;
  supplyId: string;
  auth: Record<string, string>;
}

async function setup(): Promise<Fixtures> {
  const [user, from, to, category] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Bodega' }),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory(),
  ]);
  const supply = await makeSupply({ category_id: category.id, base_unit: 'KG' });
  await seedStock({
    supply_id: supply.id,
    storage_id: from.id,
    quantity: 10,
    average_cost: 100,
  });
  return {
    userId: user.id,
    fromId: from.id,
    toId: to.id,
    supplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('createTransfer — concurrent source draw', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('does not overdraw when two transfers race on the same source stock', async () => {
    // Available stock = 10. Two concurrent transfers of 8 each. Without the
    // conditional decrement only one (or both) could slip through and leave
    // the stock at -6; the atomic guard must fail the loser.
    const body = {
      from_storage_id: f.fromId,
      to_storage_id: f.toId,
      date: '2026-04-21T00:00:00Z',
      items: [{ supply_id: f.supplyId, quantity: 8 }],
    };
    const [r1, r2] = await Promise.allSettled([
      request(app).post('/api/v1/transfers').set(f.auth).send(body),
      request(app).post('/api/v1/transfers').set(f.auth).send(body),
    ]);
    const statuses = [r1, r2].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const srcStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: f.supplyId, storage_id: f.fromId },
    });
    expect(Number(srcStock.quantity)).toBeGreaterThanOrEqual(0);
    expect(srcStock.quantity.toString()).toBe('2');

    const transfers = await prisma.transfer.findMany();
    expect(transfers).toHaveLength(1);
  });
});

describe('createTransfer — active storage guards', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('rejects a transfer from an inactive storage', async () => {
    await prisma.storage.update({ where: { id: f.fromId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.auth)
      .send({
        from_storage_id: f.fromId,
        to_storage_id: f.toId,
        date: '2026-04-21T00:00:00Z',
        items: [{ supply_id: f.supplyId, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/from_storage is inactive/i);
  });

  it('rejects a transfer to an inactive storage', async () => {
    await prisma.storage.update({ where: { id: f.toId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.auth)
      .send({
        from_storage_id: f.fromId,
        to_storage_id: f.toId,
        date: '2026-04-21T00:00:00Z',
        items: [{ supply_id: f.supplyId, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/to_storage is inactive/i);
  });
});
