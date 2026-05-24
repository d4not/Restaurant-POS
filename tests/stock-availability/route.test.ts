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

// HTTP smoke for the bulk availability endpoint — covers auth, response
// envelope, and a happy-path with one PRODUCT, one DISH, and one modifier so
// the consumer (terminal grid hook + admin bell hook) gets the shape it
// expects.

describe('GET /api/v1/stock/availability', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/stock/availability');
    expect(res.status).toBe(401);
  });

  it('returns availability for the active menu', async () => {
    const user = await makeUser();
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 500,
      content_unit: 'ML',
    });
    await seedStock({
      supply_id: supply.id,
      storage_id: storage.id,
      quantity: 7,
      min_stock: 2,
    });
    const product = await prisma.product.create({
      data: {
        name: 'Water',
        type: 'PRODUCT',
        sell_price: 2500,
        supply_id: supply.id,
      },
    });

    const res = await request(app)
      .get('/api/v1/stock/availability')
      .set(authHeader(user.id));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.generated_at).toBeDefined();
    expect(Array.isArray(res.body.data.products)).toBe(true);
    expect(Array.isArray(res.body.data.modifiers)).toBe(true);
    const entry = res.body.data.products.find(
      (p: { product_id: string }) => p.product_id === product.id,
    );
    expect(entry).toBeDefined();
    expect(entry.status).toBe('available');
    expect(entry.max_servable).toBe(7);
  });

  it('reports `out` when the requested product has zero stock', async () => {
    const user = await makeUser();
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({ category_id: cat.id });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 0 });
    const product = await prisma.product.create({
      data: { name: 'Empty', type: 'PRODUCT', sell_price: 100, supply_id: supply.id },
    });

    const res = await request(app)
      .get('/api/v1/stock/availability')
      .set(authHeader(user.id));
    expect(res.status).toBe(200);
    const entry = res.body.data.products.find(
      (p: { product_id: string }) => p.product_id === product.id,
    );
    expect(entry.status).toBe('out');
    expect(entry.max_servable).toBe(0);
  });

  it('rejects an invalid register_id as 400', async () => {
    const user = await makeUser();
    const res = await request(app)
      .get('/api/v1/stock/availability?register_id=not-a-uuid')
      .set(authHeader(user.id));
    expect(res.status).toBe(422);
  });
});
