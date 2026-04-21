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
  milkId: string;
  beansId: string;
  auth: Record<string, string>;
}

async function setupFixtures(): Promise<Fixtures> {
  const [user, storage, category] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const milk = await makeSupply({
    category_id: category.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const beans = await makeSupply({
    category_id: category.id,
    name: 'Espresso Beans',
    base_unit: 'KG',
  });
  await seedStock({
    supply_id: milk.id,
    storage_id: storage.id,
    quantity: 12,
    average_cost: 2800,
  });
  await seedStock({
    supply_id: beans.id,
    storage_id: storage.id,
    quantity: 5,
    average_cost: 30000,
  });
  return {
    userId: user.id,
    storageId: storage.id,
    milkId: milk.id,
    beansId: beans.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('Inventory checks', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('FULL check: creating seeds all stocked supplies with expected_qty', async () => {
    const res = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.items).toHaveLength(2);

    const items = res.body.data.items as Array<{
      supply_id: string;
      expected_qty: string;
      actual_qty: string;
      difference: string;
    }>;
    const milkItem = items.find((i) => i.supply_id === fixtures.milkId)!;
    expect(milkItem.expected_qty).toBe('12');
    expect(milkItem.actual_qty).toBe('12');
    expect(milkItem.difference).toBe('0');
  });

  it('PARTIAL check adjusts stock and logs ADJUSTMENT for differences only', async () => {
    // Start a PARTIAL check on just milk — beans should be untouched.
    const create = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'PARTIAL',
        date: '2026-04-21T00:00:00Z',
        supply_ids: [fixtures.milkId],
      });
    expect(create.status).toBe(201);
    const checkId = create.body.data.id as string;

    // Count reports 10 bottles (short by 2).
    const setRes = await request(app)
      .patch(`/api/v1/inventory-checks/${checkId}/items`)
      .set(fixtures.auth)
      .send({
        items: [{ supply_id: fixtures.milkId, actual_qty: 10 }],
      });
    expect(setRes.status).toBe(200);
    const updatedMilk = (setRes.body.data.items as Array<{
      supply_id: string;
      actual_qty: string;
      difference: string;
      difference_cost: string;
    }>).find((i) => i.supply_id === fixtures.milkId)!;
    expect(updatedMilk.actual_qty).toBe('10');
    expect(updatedMilk.difference).toBe('-2');
    // difference_cost = -2 * 2800 = -5600 centavos
    expect(updatedMilk.difference_cost).toBe('-5600');

    // Complete: stock snaps to 10, ADJUSTMENT movement of -2 recorded.
    const complete = await request(app)
      .post(`/api/v1/inventory-checks/${checkId}/complete`)
      .set(fixtures.auth);
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('COMPLETED');
    expect(complete.body.data.completed_at).toBeTruthy();

    const milkStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.milkId, storage_id: fixtures.storageId },
    });
    expect(milkStock.quantity.toString()).toBe('10');

    // Beans stock is untouched by a partial check.
    const beansStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.beansId, storage_id: fixtures.storageId },
    });
    expect(beansStock.quantity.toString()).toBe('5');

    const movements = await prisma.stockMovement.findMany({
      where: { reference_type: 'InventoryCheck', reference_id: checkId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe('ADJUSTMENT');
    expect(movements[0]!.quantity.toString()).toBe('-2');
    expect(movements[0]!.supply_id).toBe(fixtures.milkId);
    expect(movements[0]!.unit_cost.toString()).toBe('2800');
  });

  it('FULL check: positive difference also adjusts stock', async () => {
    const create = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    const checkId = create.body.data.id as string;

    // Milk: expected 12, actual 15 (+3). Beans: unchanged.
    await request(app)
      .patch(`/api/v1/inventory-checks/${checkId}/items`)
      .set(fixtures.auth)
      .send({
        items: [{ supply_id: fixtures.milkId, actual_qty: 15 }],
      })
      .expect(200);

    await request(app)
      .post(`/api/v1/inventory-checks/${checkId}/complete`)
      .set(fixtures.auth)
      .expect(200);

    const milkStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.milkId, storage_id: fixtures.storageId },
    });
    expect(milkStock.quantity.toString()).toBe('15');

    const movements = await prisma.stockMovement.findMany({
      where: { reference_id: checkId, type: 'ADJUSTMENT' },
    });
    // Only 1 ADJUSTMENT (milk) — beans had zero difference, no movement.
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity.toString()).toBe('3');
  });

  it('rejects completing an already-completed check', async () => {
    const create = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    const checkId = create.body.data.id as string;

    await request(app)
      .post(`/api/v1/inventory-checks/${checkId}/complete`)
      .set(fixtures.auth)
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/inventory-checks/${checkId}/complete`)
      .set(fixtures.auth);
    expect(res.status).toBe(409);
  });

  it('rejects setting items on a completed check', async () => {
    const create = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'FULL',
        date: '2026-04-21T00:00:00Z',
      });
    const checkId = create.body.data.id as string;

    await request(app)
      .post(`/api/v1/inventory-checks/${checkId}/complete`)
      .set(fixtures.auth)
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/inventory-checks/${checkId}/items`)
      .set(fixtures.auth)
      .send({ items: [{ supply_id: fixtures.milkId, actual_qty: 9 }] });
    expect(res.status).toBe(409);
  });

  it('PARTIAL check requires supply_ids', async () => {
    const res = await request(app)
      .post('/api/v1/inventory-checks')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        type: 'PARTIAL',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(400);
  });
});
