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
  bodegaId: string;
  barraId: string;
  supplyId: string;
  auth: Record<string, string>;
}

async function setupFixtures(): Promise<Fixtures> {
  const [user, bodega, barra, category] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Bodega' }),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  await seedStock({
    supply_id: supply.id,
    storage_id: bodega.id,
    quantity: 10,
    average_cost: 2800,
  });
  return {
    userId: user.id,
    bodegaId: bodega.id,
    barraId: barra.id,
    supplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

describe('POST /api/v1/transfers', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('moves stock from source to destination and logs both movements', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(fixtures.auth)
      .send({
        from_storage_id: fixtures.bodegaId,
        to_storage_id: fixtures.barraId,
        date: '2026-04-21T00:00:00Z',
        items: [{ supply_id: fixtures.supplyId, quantity: 4 }],
      });
    expect(res.status).toBe(201);

    const fromStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.bodegaId },
    });
    expect(fromStock.quantity.toString()).toBe('6');

    const toStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.barraId },
    });
    expect(toStock.quantity.toString()).toBe('4');

    const movements = await prisma.stockMovement.findMany({
      where: { supply_id: fixtures.supplyId },
      orderBy: [{ type: 'asc' }, { created_at: 'asc' }],
    });
    expect(movements).toHaveLength(2);
    const outMov = movements.find((m) => m.type === 'TRANSFER_OUT')!;
    const inMov = movements.find((m) => m.type === 'TRANSFER_IN')!;
    expect(outMov.quantity.toString()).toBe('-4');
    expect(outMov.storage_id).toBe(fixtures.bodegaId);
    expect(outMov.unit_cost.toString()).toBe('2800');
    expect(inMov.quantity.toString()).toBe('4');
    expect(inMov.storage_id).toBe(fixtures.barraId);
    expect(inMov.reference_type).toBe('Transfer');
    expect(inMov.reference_id).toBe(res.body.data.id);
  });

  it('fails when source stock is insufficient and rolls back completely', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(fixtures.auth)
      .send({
        from_storage_id: fixtures.bodegaId,
        to_storage_id: fixtures.barraId,
        date: '2026-04-21T00:00:00Z',
        // Only 10 in source; requesting 20 must fail.
        items: [{ supply_id: fixtures.supplyId, quantity: 20 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    // No transfer row, no movements, source stock unchanged, dest still absent.
    const transfers = await prisma.transfer.findMany();
    expect(transfers).toHaveLength(0);

    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(0);

    const fromStock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.bodegaId },
    });
    expect(fromStock.quantity.toString()).toBe('10');

    const toStock = await prisma.storageStock.findFirst({
      where: { supply_id: fixtures.supplyId, storage_id: fixtures.barraId },
    });
    expect(toStock).toBeNull();
  });

  it('fails when source has no stock row for the supply', async () => {
    const otherSupply = await makeSupply({ name: 'Espresso Beans', base_unit: 'KG' });
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(fixtures.auth)
      .send({
        from_storage_id: fixtures.bodegaId,
        to_storage_id: fixtures.barraId,
        date: '2026-04-21T00:00:00Z',
        items: [{ supply_id: otherSupply.id, quantity: 1 }],
      });
    expect(res.status).toBe(409);
  });

  it('rejects transfers where from and to storages are identical', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(fixtures.auth)
      .send({
        from_storage_id: fixtures.bodegaId,
        to_storage_id: fixtures.bodegaId,
        date: '2026-04-21T00:00:00Z',
        items: [{ supply_id: fixtures.supplyId, quantity: 1 }],
      });
    expect(res.status).toBe(422);
  });

  it('aggregates duplicate supply lines for the source-stock check', async () => {
    // Source has only 10; two lines of 6 each should aggregate to 12 > 10.
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(fixtures.auth)
      .send({
        from_storage_id: fixtures.bodegaId,
        to_storage_id: fixtures.barraId,
        date: '2026-04-21T00:00:00Z',
        items: [
          { supply_id: fixtures.supplyId, quantity: 6 },
          { supply_id: fixtures.supplyId, quantity: 6 },
        ],
      });
    expect(res.status).toBe(409);
  });
});
