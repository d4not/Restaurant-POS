import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
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
  bodegaId: string;
  barraId: string;
  supplyId: string;
  cashierAuth: Record<string, string>;
  waiterAuth: Record<string, string>;
  baristaAuth: Record<string, string>;
  managerAuth: Record<string, string>;
  adminAuth: Record<string, string>;
}

async function setupFixtures(): Promise<Fixtures> {
  const [waiter, barista, cashier, manager, admin, bodega, barra, category] =
    await Promise.all([
      makeUser({ role: 'WAITER' }),
      makeUser({ role: 'BARISTA' }),
      makeUser({ role: 'CASHIER' }),
      makeUser({ role: 'MANAGER' }),
      makeUser({ role: 'ADMIN' }),
      makeStorage({ name: 'Bodega' }),
      makeStorage({ name: 'Barra' }),
      makeSupplyCategory(),
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
    bodegaId: bodega.id,
    barraId: barra.id,
    supplyId: supply.id,
    waiterAuth: authHeader(waiter.id, 'WAITER'),
    baristaAuth: authHeader(barista.id, 'BARISTA'),
    cashierAuth: authHeader(cashier.id, 'CASHIER'),
    managerAuth: authHeader(manager.id, 'MANAGER'),
    adminAuth: authHeader(admin.id, 'ADMIN'),
  };
}

function transferBody(f: Fixtures) {
  return {
    from_storage_id: f.bodegaId,
    to_storage_id: f.barraId,
    date: '2026-04-21T00:00:00Z',
    items: [{ supply_id: f.supplyId, quantity: 1 }],
  };
}

describe('POST /api/v1/transfers — role gate', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setupFixtures();
  });

  // Transfers are operational (moving stock between storages) and don't
  // touch money, so any signed-in user can perform them. The StockMovement
  // audit log still records the actor.
  it('allows WAITER', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.waiterAuth)
      .send(transferBody(f));
    expect(res.status).toBe(201);
  });

  it('allows BARISTA', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.baristaAuth)
      .send(transferBody(f));
    expect(res.status).toBe(201);
  });

  it('allows CASHIER', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.cashierAuth)
      .send(transferBody(f));
    expect(res.status).toBe(201);
  });

  it('allows MANAGER', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.managerAuth)
      .send(transferBody(f));
    expect(res.status).toBe(201);
  });

  it('allows ADMIN', async () => {
    const res = await request(app)
      .post('/api/v1/transfers')
      .set(f.adminAuth)
      .send(transferBody(f));
    expect(res.status).toBe(201);
  });

  it('still allows WAITER to read transfers list', async () => {
    const res = await request(app).get('/api/v1/transfers').set(f.waiterAuth);
    expect(res.status).toBe(200);
  });
});
