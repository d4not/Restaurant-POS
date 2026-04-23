import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupplier,
  makeSupply,
  makeSupplyCategory,
  makeUser,
} from '../helpers/factories.js';

const app = getTestApp();

// Compact dine-in scenario: one storage, one PRODUCT (Bottled Water — no
// recipe needed) so each test can focus on table state transitions instead of
// recipe machinery.
interface Scenario {
  auth: Record<string, string>;
  registerId: string;
  productId: string;
  zoneId: string;
  table1Id: string;
  table2Id: string;
}

async function seedScenario(): Promise<Scenario> {
  const [user, supplier, barra, cat] = await Promise.all([
    makeUser(),
    makeSupplier(),
    makeStorage({ name: 'Bar' }),
    makeSupplyCategory(),
  ]);
  const auth = authHeader(user.id);
  const water = await makeSupply({
    category_id: cat.id,
    base_unit: 'BOTTLE',
    content_per_unit: 500,
    content_unit: 'ML',
  });

  const purchase = await request(app).post('/api/v1/purchases').set(auth).send({
    supplier_id: supplier.id,
    storage_id: barra.id,
    date: '2026-04-22T00:00:00Z',
    items: [
      { supply_id: water.id, packaging_id: null, package_quantity: 50, price_per_package: 1200 },
    ],
  });
  expect(purchase.status).toBe(201);
  await request(app)
    .post(`/api/v1/purchases/${purchase.body.data.id}/confirm`)
    .set(auth)
    .expect(200);

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({
      name: 'Bottled Water',
      type: 'PRODUCT',
      sell_price: 2500,
      supply_id: water.id,
    })
    .expect(201);

  const register = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: 0 })
    .expect(201);

  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ pos_register_id: register.body.data.id, storage_id: barra.id })
    .expect(201);

  const zone = await request(app)
    .post('/api/v1/zones')
    .set(auth)
    .send({ name: 'Indoor' })
    .expect(201);
  const t1 = await request(app)
    .post('/api/v1/tables')
    .set(auth)
    .send({ zone_id: zone.body.data.id, number: 1 })
    .expect(201);
  const t2 = await request(app)
    .post('/api/v1/tables')
    .set(auth)
    .send({ zone_id: zone.body.data.id, number: 2 })
    .expect(201);

  return {
    auth,
    registerId: register.body.data.id,
    productId: product.body.data.id,
    zoneId: zone.body.data.id,
    table1Id: t1.body.data.id,
    table2Id: t2.body.data.id,
  };
}

async function addOneItemAndPay(
  s: Scenario,
  orderId: string,
  amount = 2500,
): Promise<void> {
  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(s.auth)
    .send({ product_id: s.productId, quantity: 1 })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${orderId}/payments`)
    .set(s.auth)
    .send({ method: 'CASH', amount })
    .expect(201);
}

describe('Order ↔ Table lifecycle', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('creating a DINE_IN order with table_id flips the table to OCCUPIED', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      });
    expect(order.status).toBe(201);
    expect(order.body.data.table.id).toBe(s.table1Id);
    expect(order.body.data.table.number).toBe(1);
    expect(order.body.data.table.status).toBe('OCCUPIED');

    const table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('OCCUPIED');
  });

  it('creating an order without table_id leaves both fields untouched', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'DINE_IN' })
      .expect(201);
    expect(order.body.data.table_id).toBeNull();
    expect(order.body.data.table).toBeNull();
  });

  it('rejects table_id on TAKEOUT orders', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'TAKEOUT',
        table_id: s.table1Id,
      });
    expect(res.status).toBe(400);
  });

  it('rejects table_id pointing at a non-existent table', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: '00000000-0000-0000-0000-000000000000',
      });
    expect(res.status).toBe(400);
  });

  it('rejects an inactive table', async () => {
    await request(app).delete(`/api/v1/tables/${s.table1Id}`).set(s.auth).expect(204);
    const res = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      });
    expect(res.status).toBe(400);
  });

  it('paying the only open order on a table releases it back to AVAILABLE', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    await addOneItemAndPay(s, order.body.data.id);

    const table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('AVAILABLE');
  });

  it('cancelling the only open order on a table releases it back to AVAILABLE', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    await request(app).delete(`/api/v1/orders/${order.body.data.id}`).set(s.auth).expect(200);
    const table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('AVAILABLE');
  });

  it('group ordering: a second order on the same table keeps it OCCUPIED after the first settles', async () => {
    const o1 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    const o2 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);

    // Pay only the first ticket.
    await addOneItemAndPay(s, o1.body.data.id);
    let table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('OCCUPIED');

    // Pay the second — now the party is fully settled.
    await addOneItemAndPay(s, o2.body.data.id);
    table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('AVAILABLE');
  });

  it('manually RESERVED tables stay RESERVED through the order lifecycle', async () => {
    await request(app)
      .patch(`/api/v1/tables/${s.table1Id}/status`)
      .set(s.auth)
      .send({ status: 'RESERVED' })
      .expect(200);

    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    let table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('RESERVED');

    await addOneItemAndPay(s, order.body.data.id);
    table = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    expect(table.status).toBe('RESERVED');
  });

  it('PATCH /orders/:id reseating moves the OCCUPIED badge between tables', async () => {
    const order = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);

    // Reseat to table 2.
    const moved = await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(s.auth)
      .send({ table_id: s.table2Id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.table.id).toBe(s.table2Id);

    const t1 = await prisma.table.findUniqueOrThrow({ where: { id: s.table1Id } });
    const t2 = await prisma.table.findUniqueOrThrow({ where: { id: s.table2Id } });
    expect(t1.status).toBe('AVAILABLE');
    expect(t2.status).toBe('OCCUPIED');

    // Detach the table altogether → back to AVAILABLE.
    const detached = await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(s.auth)
      .send({ table_id: null });
    expect(detached.status).toBe(200);
    expect(detached.body.data.table).toBeNull();

    const t2After = await prisma.table.findUniqueOrThrow({ where: { id: s.table2Id } });
    expect(t2After.status).toBe('AVAILABLE');
  });

  it('list /orders supports table_id and zone_id filters', async () => {
    const o1 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    const o2 = await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table2Id,
      })
      .expect(201);
    await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({ register_id: s.registerId, order_type: 'TAKEOUT' })
      .expect(201);

    const byTable = await request(app)
      .get(`/api/v1/orders?table_id=${s.table1Id}`)
      .set(s.auth);
    expect(byTable.body.data.items.map((o: { id: string }) => o.id)).toEqual([
      o1.body.data.id,
    ]);

    const byZone = await request(app)
      .get(`/api/v1/orders?zone_id=${s.zoneId}`)
      .set(s.auth);
    const ids = byZone.body.data.items.map((o: { id: string }) => o.id).sort();
    expect(ids).toEqual([o1.body.data.id, o2.body.data.id].sort());
  });

  it('blocks deleting a zone with open orders on its tables', async () => {
    await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    const del = await request(app).delete(`/api/v1/zones/${s.zoneId}`).set(s.auth);
    expect(del.status).toBe(409);
  });

  it('blocks deleting a table with open orders', async () => {
    await request(app)
      .post('/api/v1/orders')
      .set(s.auth)
      .send({
        register_id: s.registerId,
        order_type: 'DINE_IN',
        table_id: s.table1Id,
      })
      .expect(201);
    const del = await request(app).delete(`/api/v1/tables/${s.table1Id}`).set(s.auth);
    expect(del.status).toBe(409);
  });
});
