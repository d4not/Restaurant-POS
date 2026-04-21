import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeSupplyCategory, makeSupply } from '../helpers/factories.js';

const app = getTestApp();

describe('Tare weights nested under a supply', () => {
  let auth: Record<string, string>;
  let supplyId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const cat = await makeSupplyCategory();
    supplyId = (
      await makeSupply({
        category_id: cat.id,
        base_unit: 'BOTTLE',
        content_per_unit: 946,
        content_unit: 'ML',
      })
    ).id;
  });

  it('upsert + get + delete', async () => {
    const put = await request(app)
      .put(`/api/v1/supplies/${supplyId}/tare-weight`)
      .set(auth)
      .send({
        empty_weight_grams: 500,
        full_weight_grams: 1446,
        net_content: 946,
      });
    expect(put.status).toBe(200);

    const get = await request(app)
      .get(`/api/v1/supplies/${supplyId}/tare-weight`)
      .set(auth);
    expect(get.status).toBe(200);
    expect(get.body.data.net_content.toString()).toBe('946');

    // Upsert again to change a value.
    const put2 = await request(app)
      .put(`/api/v1/supplies/${supplyId}/tare-weight`)
      .set(auth)
      .send({
        empty_weight_grams: 520,
        full_weight_grams: 1446,
        net_content: 946,
      });
    expect(put2.status).toBe(200);

    await request(app)
      .delete(`/api/v1/supplies/${supplyId}/tare-weight`)
      .set(auth)
      .expect(204);

    await request(app)
      .get(`/api/v1/supplies/${supplyId}/tare-weight`)
      .set(auth)
      .expect(404);
  });
});

describe('Product modifications', () => {
  let auth: Record<string, string>;
  let productId: string;
  let supplyId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const cat = await makeSupplyCategory();
    supplyId = (await makeSupply({ category_id: cat.id })).id;
    const p = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Juice',
        type: 'PRODUCT',
        sell_price: 4000,
        supply_id: supplyId,
      });
    expect(p.status).toBe(201);
    productId = p.body.data.id;
  });

  it('creates, lists, updates, and deletes modifications for a PRODUCT', async () => {
    const create = await request(app)
      .post(`/api/v1/products/${productId}/modifications`)
      .set(auth)
      .send({ name: 'Orange', sell_price: 4000 });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const list = await request(app)
      .get(`/api/v1/products/${productId}/modifications`)
      .set(auth);
    expect(list.body.data).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/products/${productId}/modifications/${id}`)
      .set(auth)
      .send({ sell_price: 4500 });
    expect(update.status).toBe(200);
    expect(update.body.data.sell_price.toString()).toBe('4500');

    await request(app)
      .delete(`/api/v1/products/${productId}/modifications/${id}`)
      .set(auth)
      .expect(204);
  });

  it('rejects modifications on a DISH', async () => {
    const dish = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({ name: 'Latte', type: 'DISH' });
    expect(dish.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/products/${dish.body.data.id}/modifications`)
      .set(auth)
      .send({ name: 'Small', sell_price: 4000 });
    expect(res.status).toBe(400);
  });

  it('rejects a soft-deleted supply reference', async () => {
    await prisma.supply.update({ where: { id: supplyId }, data: { deleted_at: new Date() } });
    const res = await request(app)
      .post(`/api/v1/products/${productId}/modifications`)
      .set(auth)
      .send({ name: 'Orange', sell_price: 4000, supply_id: supplyId });
    expect(res.status).toBe(400);
  });
});

describe('Stock movements list + get', () => {
  it('returns paginated movements and respects filters', async () => {
    const auth = authHeader((await makeUser()).id);
    // Seed two movements via the helpers — we create them directly for this
    // read-only test rather than exercising the full purchase flow.
    const cat = await makeSupplyCategory();
    const supply = await makeSupply({ category_id: cat.id });
    const storage = await prisma.storage.create({ data: { name: 'Bodega' } });
    await prisma.stockMovement.create({
      data: {
        supply_id: supply.id,
        storage_id: storage.id,
        type: 'ADJUSTMENT',
        quantity: 5,
        reference_type: 'Seed',
        reference_id: '00000000-0000-0000-0000-000000000000',
        unit_cost: 100,
      },
    });
    const second = await prisma.stockMovement.create({
      data: {
        supply_id: supply.id,
        storage_id: storage.id,
        type: 'WRITE_OFF',
        quantity: -2,
        reference_type: 'Seed',
        reference_id: '00000000-0000-0000-0000-000000000000',
        unit_cost: 100,
      },
    });

    const list = await request(app)
      .get(`/api/v1/stock-movements?supply_id=${supply.id}`)
      .set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(2);

    const filtered = await request(app)
      .get(`/api/v1/stock-movements?type=WRITE_OFF`)
      .set(auth);
    expect(filtered.body.data.items).toHaveLength(1);

    const single = await request(app)
      .get(`/api/v1/stock-movements/${second.id}`)
      .set(auth);
    expect(single.status).toBe(200);
    expect(single.body.data.type).toBe('WRITE_OFF');
  });
});
