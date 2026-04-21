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

async function setupFixtures(): Promise<Fixtures> {
  const [user, storage, category] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
  });
  await seedStock({
    supply_id: supply.id,
    storage_id: storage.id,
    quantity: 8,
    average_cost: 2800,
  });
  return {
    userId: user.id,
    storageId: storage.id,
    supplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('POST /api/v1/write-offs', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('reduces stock and logs WRITE_OFF movement', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        supply_id: fixtures.supplyId,
        quantity: 3,
        reason: 'EXPIRED',
        notes: 'past date',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.reason).toBe('EXPIRED');
    const writeOffId = res.body.data.id as string;

    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('5');

    const movements = await prisma.stockMovement.findMany({
      where: { reference_type: 'WriteOff', reference_id: writeOffId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe('WRITE_OFF');
    expect(movements[0]!.quantity.toString()).toBe('-3');
    expect(movements[0]!.unit_cost.toString()).toBe('2800');
    expect(movements[0]!.supply_id).toBe(fixtures.supplyId);
    expect(movements[0]!.storage_id).toBe(fixtures.storageId);
  });

  it('rejects write-off exceeding available stock and rolls back', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        supply_id: fixtures.supplyId,
        quantity: 100,
        reason: 'SPILLED',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(409);

    const writeOffs = await prisma.writeOff.findMany();
    expect(writeOffs).toHaveLength(0);

    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(0);

    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('8');
  });

  it('accepts every valid reason enum value', async () => {
    for (const reason of ['EXPIRED', 'DAMAGED', 'SPILLED', 'THEFT', 'OTHER']) {
      const res = await request(app)
        .post('/api/v1/write-offs')
        .set(fixtures.auth)
        .send({
          storage_id: fixtures.storageId,
          supply_id: fixtures.supplyId,
          quantity: 1,
          reason,
          date: '2026-04-21T00:00:00Z',
        });
      expect(res.status).toBe(201);
    }
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.storageId },
    });
    // Started with 8, wrote off 1 * 5 = 5, so 3 remain.
    expect(stock.quantity.toString()).toBe('3');
  });

  it('lists write-offs with filtering by reason', async () => {
    await request(app)
      .post('/api/v1/write-offs')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        supply_id: fixtures.supplyId,
        quantity: 1,
        reason: 'EXPIRED',
        date: '2026-04-21T00:00:00Z',
      })
      .expect(201);
    await request(app)
      .post('/api/v1/write-offs')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        supply_id: fixtures.supplyId,
        quantity: 2,
        reason: 'THEFT',
        date: '2026-04-21T00:00:00Z',
      })
      .expect(201);

    const res = await request(app)
      .get('/api/v1/write-offs?reason=THEFT')
      .set(fixtures.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].reason).toBe('THEFT');
  });
});
