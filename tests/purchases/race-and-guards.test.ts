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
  userId: string;
  supplierId: string;
  storageId: string;
  supplyId: string;
  auth: Record<string, string>;
}

async function setup(): Promise<Fixtures> {
  const [user, supplier, storage, category] = await Promise.all([
    makeUser(),
    makeSupplier(),
    makeStorage(),
    makeSupplyCategory(),
  ]);
  const supply = await makeSupply({
    category_id: category.id,
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  return {
    userId: user.id,
    supplierId: supplier.id,
    storageId: storage.id,
    supplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

async function draftWithItem(f: Fixtures, qty: number, price: number): Promise<string> {
  const res = await request(app)
    .post('/api/v1/purchases')
    .set(f.auth)
    .send({
      supplier_id: f.supplierId,
      storage_id: f.storageId,
      date: '2026-04-21T00:00:00Z',
      items: [
        {
          supply_id: f.supplyId,
          package_quantity: qty,
          price_per_package: price,
        },
      ],
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('confirmPurchase — concurrent claim', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('only one of two concurrent confirms lands stock + movements', async () => {
    const purchaseId = await draftWithItem(f, 10, 1000);
    const [r1, r2] = await Promise.allSettled([
      request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(f.auth),
      request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(f.auth),
    ]);

    const statuses = [r1, r2].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    // Exactly one should win (200), the other should see a CONFLICT (409).
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    // Stock incremented exactly once, one movement, WAC consistent.
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: f.supplyId, storage_id: f.storageId },
    });
    expect(stock.quantity.toString()).toBe('10');

    const movements = await prisma.stockMovement.findMany({
      where: { reference_id: purchaseId },
    });
    expect(movements).toHaveLength(1);
  });
});

describe('createPurchase — active ref guards', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setup();
  });

  it('rejects a purchase for an inactive supplier', async () => {
    await prisma.supplier.update({ where: { id: f.supplierId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/purchases')
      .set(f.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-04-21T00:00:00Z',
        items: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/supplier is inactive/i);
  });

  it('rejects a purchase for an inactive storage', async () => {
    await prisma.storage.update({ where: { id: f.storageId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/purchases')
      .set(f.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-04-21T00:00:00Z',
        items: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/storage is inactive/i);
  });

  it('rejects updating a draft to point at an inactive supplier', async () => {
    const draftId = await draftWithItem(f, 1, 100);
    const otherSupplier = await makeSupplier();
    await prisma.supplier.update({ where: { id: otherSupplier.id }, data: { active: false } });

    const res = await request(app)
      .patch(`/api/v1/purchases/${draftId}`)
      .set(f.auth)
      .send({ supplier_id: otherSupplier.id });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/supplier is inactive/i);
  });
});
