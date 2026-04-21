import { describe, it, expect } from 'vitest';
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

async function setup() {
  const [user, barra, bodega, dairy] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Barra' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const milk = await makeSupply({
    category_id: dairy.id,
    name: 'Whole Milk',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const almond = await makeSupply({
    category_id: dairy.id,
    name: 'Almond Milk',
    base_unit: 'BOTTLE',
    content_per_unit: 1000,
    content_unit: 'ML',
  });
  const espresso = await makeSupply({
    category_id: dairy.id,
    name: 'Espresso Beans',
    base_unit: 'BAG',
  });

  // Below threshold at Barra — should appear.
  await seedStock({
    supply_id: milk.id,
    storage_id: barra.id,
    quantity: 2,
    min_stock: 5,
    average_cost: 3000,
  });
  // Equal to threshold — also triggers (<=).
  await seedStock({
    supply_id: almond.id,
    storage_id: barra.id,
    quantity: 3,
    min_stock: 3,
    average_cost: 5000,
  });
  // Below threshold at Bodega — should appear, scoped to Bodega only.
  await seedStock({
    supply_id: espresso.id,
    storage_id: bodega.id,
    quantity: 1,
    min_stock: 2,
    average_cost: 40000,
  });
  // No min_stock configured — must not appear regardless of quantity.
  const supplyNoMin = await makeSupply({ category_id: dairy.id, name: 'Untracked' });
  await seedStock({
    supply_id: supplyNoMin.id,
    storage_id: barra.id,
    quantity: 0,
    average_cost: 100,
  });

  return {
    auth: authHeader(user.id),
    barraId: barra.id,
    bodegaId: bodega.id,
    milkId: milk.id,
    almondId: almond.id,
    espressoId: espresso.id,
  };
}

describe('GET /api/v1/alerts/low-stock', () => {
  it('returns rows where quantity <= min_stock and ignores rows without a threshold', async () => {
    const s = await setup();
    const res = await request(app)
      .get('/api/v1/alerts/low-stock')
      .set(s.auth)
      .expect(200);

    const items = res.body.data.items as Array<{
      supply_id: string;
      storage_id: string;
      quantity: string;
      min_stock: string;
      shortfall: string;
    }>;
    expect(items).toHaveLength(3);
    const byId = new Map(items.map((i) => [`${i.supply_id}|${i.storage_id}`, i]));
    expect(byId.get(`${s.milkId}|${s.barraId}`)?.shortfall).toBe('3');
    expect(byId.get(`${s.almondId}|${s.barraId}`)?.shortfall).toBe('0');
    expect(byId.get(`${s.espressoId}|${s.bodegaId}`)?.shortfall).toBe('1');
  });

  it('filters by storage_id', async () => {
    const s = await setup();
    const res = await request(app)
      .get(`/api/v1/alerts/low-stock?storage_id=${s.barraId}`)
      .set(s.auth)
      .expect(200);

    const items = res.body.data.items as Array<{ storage_id: string }>;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.storage_id === s.barraId)).toBe(true);
  });

  it('excludes soft-deleted supplies', async () => {
    const s = await setup();
    await prisma.supply.update({
      where: { id: s.milkId },
      data: { deleted_at: new Date() },
    });
    const res = await request(app)
      .get(`/api/v1/alerts/low-stock?storage_id=${s.barraId}`)
      .set(s.auth)
      .expect(200);
    const items = res.body.data.items as Array<{ supply_id: string }>;
    expect(items.find((i) => i.supply_id === s.milkId)).toBeUndefined();
  });

  it('rejects requests without auth', async () => {
    await request(app).get('/api/v1/alerts/low-stock').expect(401);
  });
});
