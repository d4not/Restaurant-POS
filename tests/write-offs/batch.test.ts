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
  espressoId: string;
  syrupId: string;
  milkId: string;
  auth: Record<string, string>;
}

async function setupFixtures(): Promise<Fixtures> {
  const [user, storage, category] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Bar' }),
    makeSupplyCategory({ name: 'Drinks' }),
  ]);
  const [espresso, syrup, milk] = await Promise.all([
    makeSupply({
      category_id: category.id,
      name: 'Espresso Beans 1kg',
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
    }),
    makeSupply({
      category_id: category.id,
      name: 'Vanilla Syrup',
      base_unit: 'BOTTLE',
      content_per_unit: 750,
      content_unit: 'ML',
    }),
    makeSupply({
      category_id: category.id,
      name: 'Whole Milk',
      base_unit: 'BOTTLE',
      content_per_unit: 946,
      content_unit: 'ML',
    }),
  ]);
  await Promise.all([
    seedStock({ supply_id: espresso.id, storage_id: storage.id, quantity: 2, average_cost: 18000 }),
    seedStock({ supply_id: syrup.id, storage_id: storage.id, quantity: 4, average_cost: 9000 }),
    seedStock({ supply_id: milk.id, storage_id: storage.id, quantity: 6, average_cost: 2800 }),
  ]);
  return {
    userId: user.id,
    storageId: storage.id,
    espressoId: espresso.id,
    syrupId: syrup.id,
    milkId: milk.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('POST /api/v1/write-offs/batch', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('writes off multiple lines atomically and applies ticket-level defaults', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs/batch')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        date: '2026-04-21T00:00:00Z',
        reason: 'OTHER',
        notes: 'Wrong syrup — discarded shot + syrup',
        items: [
          { supply_id: fixtures.espressoId, quantity: 0.018 },
          { supply_id: fixtures.syrupId, quantity: 0.04 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);

    // Both lines used the ticket-level reason/notes.
    for (const row of res.body.data as Array<{ reason: string; notes: string }>) {
      expect(row.reason).toBe('OTHER');
      expect(row.notes).toBe('Wrong syrup — discarded shot + syrup');
    }

    const espressoStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.espressoId, storage_id: fixtures.storageId },
    });
    expect(espressoStock.quantity.toString()).toBe('1.982');

    const syrupStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.syrupId, storage_id: fixtures.storageId },
    });
    expect(syrupStock.quantity.toString()).toBe('3.96');

    // Milk was not in the batch — stock untouched.
    const milkStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.milkId, storage_id: fixtures.storageId },
    });
    expect(milkStock.quantity.toString()).toBe('6');

    const movements = await prisma.stockMovement.findMany({
      where: { reference_type: 'WriteOff' },
      orderBy: { created_at: 'asc' },
    });
    expect(movements).toHaveLength(2);
    for (const m of movements) {
      expect(m.type).toBe('WRITE_OFF');
      expect(m.quantity.toNumber()).toBeLessThan(0);
    }
  });

  it('per-line reason overrides the ticket-level default', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs/batch')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        date: '2026-04-21T00:00:00Z',
        reason: 'OTHER',
        items: [
          { supply_id: fixtures.espressoId, quantity: 0.01, reason: 'SPILLED' },
          { supply_id: fixtures.syrupId, quantity: 0.02 },
        ],
      });
    expect(res.status).toBe(201);

    const rows = await prisma.writeOff.findMany({
      where: { storage_id: fixtures.storageId },
      orderBy: { created_at: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const bySupply = new Map(rows.map((r) => [r.supply_id, r]));
    expect(bySupply.get(fixtures.espressoId)!.reason).toBe('SPILLED');
    expect(bySupply.get(fixtures.syrupId)!.reason).toBe('OTHER');
  });

  it('rolls back the entire ticket if any line lacks stock', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs/batch')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        date: '2026-04-21T00:00:00Z',
        reason: 'DAMAGED',
        items: [
          { supply_id: fixtures.espressoId, quantity: 0.5 }, // ok
          { supply_id: fixtures.milkId, quantity: 999 }, // explodes
        ],
      });
    expect(res.status).toBe(409);

    const writeOffs = await prisma.writeOff.findMany();
    expect(writeOffs).toHaveLength(0);

    const movements = await prisma.stockMovement.findMany({
      where: { reference_type: 'WriteOff' },
    });
    expect(movements).toHaveLength(0);

    // First line's decrement was rolled back — espresso stock is intact.
    const espressoStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.espressoId, storage_id: fixtures.storageId },
    });
    expect(espressoStock.quantity.toString()).toBe('2');
  });

  it('rejects empty items array', async () => {
    const res = await request(app)
      .post('/api/v1/write-offs/batch')
      .set(fixtures.auth)
      .send({
        storage_id: fixtures.storageId,
        date: '2026-04-21T00:00:00Z',
        reason: 'EXPIRED',
        items: [],
      });
    expect(res.status).toBe(422);
  });
});
