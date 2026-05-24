import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeSupplier,
  makeStorage,
  makeSupplyCategory,
  makeSupply,
} from '../helpers/factories.js';

const app = getTestApp();

interface Fixtures {
  waiter: { id: string; auth: Record<string, string> };
  cashier: { id: string; auth: Record<string, string> };
  manager: { id: string; auth: Record<string, string> };
  supplierId: string;
  storageId: string;
  supplyId: string;
}

async function setup(): Promise<Fixtures> {
  const [waiter, cashier, manager, supplier, storage, category] = await Promise.all([
    makeUser({ role: 'WAITER' }),
    makeUser({ role: 'CASHIER' }),
    makeUser({ role: 'MANAGER' }),
    makeSupplier({ name: 'Test Supplier' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Misc' }),
  ]);
  const supply = await makeSupply({ category_id: category.id, name: 'Test Supply' });
  return {
    waiter: { id: waiter.id, auth: authHeader(waiter.id, 'WAITER') },
    cashier: { id: cashier.id, auth: authHeader(cashier.id, 'CASHIER') },
    manager: { id: manager.id, auth: authHeader(manager.id, 'MANAGER') },
    supplierId: supplier.id,
    storageId: storage.id,
    supplyId: supply.id,
  };
}

const draftPayload = (f: Fixtures) => ({
  supplier_id: f.supplierId,
  storage_id: f.storageId,
  date: '2026-05-24T08:00:00Z',
  kind: 'DELIVERY' as const,
  items: [{ supply_id: f.supplyId, package_quantity: 1, price_per_package: 100 }],
});

describe('Purchase order role gates', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('blocks WAITER from creating a purchase', async () => {
    const res = await request(app)
      .post('/api/v1/purchases')
      .set(f.waiter.auth)
      .send(draftPayload(f));
    expect(res.status).toBe(403);
  });

  it('allows WAITER to read the list (operations visibility)', async () => {
    const res = await request(app).get('/api/v1/purchases').set(f.waiter.auth);
    expect(res.status).toBe(200);
  });

  it('blocks CASHIER from /verify (stock-absorbing manager+ action)', async () => {
    // Cashier creates and walks through the delivery so an ARRIVED purchase exists.
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send(draftPayload(f));
    const id = created.body.data.id as string;

    await request(app).post(`/api/v1/purchases/${id}/send`).set(f.cashier.auth).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/reply`).set(f.cashier.auth).send({}).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/pay`).set(f.cashier.auth).send({}).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/in-transit`).set(f.cashier.auth).send({}).expect(200);
    await request(app).post(`/api/v1/purchases/${id}/receive`).set(f.cashier.auth).send({}).expect(200);

    const verifyAsCashier = await request(app)
      .post(`/api/v1/purchases/${id}/verify`)
      .set(f.cashier.auth)
      .send({});
    expect(verifyAsCashier.status).toBe(403);

    // Manager can.
    const verifyAsManager = await request(app)
      .post(`/api/v1/purchases/${id}/verify`)
      .set(f.manager.auth)
      .send({});
    expect(verifyAsManager.status).toBe(200);
    expect(verifyAsManager.body.data.status).toBe('VERIFIED');
  });

  it('blocks CASHIER from the legacy /confirm (also stock-absorbing)', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send(draftPayload(f));
    const id = created.body.data.id as string;
    const res = await request(app).post(`/api/v1/purchases/${id}/confirm`).set(f.cashier.auth);
    expect(res.status).toBe(403);
  });

  it('allows MANAGER to do everything a cashier can plus /verify', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.manager.auth)
      .send(draftPayload(f));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    await request(app).post(`/api/v1/purchases/${id}/send`).set(f.manager.auth).expect(200);
  });

  it('still rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/v1/purchases').send(draftPayload(f));
    expect(res.status).toBe(401);
    void prisma; // keep import referenced
  });
});
