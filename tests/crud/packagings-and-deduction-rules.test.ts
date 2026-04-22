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

describe('PurchasePackaging CRUD', () => {
  let auth: Record<string, string>;
  let supplyId: string;
  let supplierId: string;

  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
    const [supplier, category] = await Promise.all([makeSupplier(), makeSupplyCategory()]);
    supplierId = supplier.id;
    supplyId = (await makeSupply({ category_id: category.id })).id;
  });

  it('creates, updates, lists, and soft-deletes', async () => {
    const create = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supplyId,
        supplier_id: supplierId,
        name: 'Case of 12',
        units_per_package: 12,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const update = await request(app)
      .patch(`/api/v1/packagings/${id}`)
      .set(auth)
      .send({ units_per_package: 24 });
    expect(update.status).toBe(200);
    expect(update.body.data.units_per_package.toString()).toBe('24');

    const list = await request(app)
      .get(`/api/v1/packagings?supply_id=${supplyId}`)
      .set(auth);
    expect(list.body.data.items).toHaveLength(1);

    await request(app).delete(`/api/v1/packagings/${id}`).set(auth).expect(204);
    const row = await prisma.purchasePackaging.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(false);
  });

  it('rejects an inactive supplier reference', async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { active: false } });
    const res = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supplyId,
        supplier_id: supplierId,
        name: 'Box',
        units_per_package: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/supplier is inactive/i);
  });

  it('rejects a soft-deleted supply reference', async () => {
    await prisma.supply.update({ where: { id: supplyId }, data: { deleted_at: new Date() } });
    const res = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supplyId,
        supplier_id: supplierId,
        name: 'Box',
        units_per_package: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/supply/i);
  });

  it('allows exactly one primary packaging per supply', async () => {
    const supplier2 = await makeSupplier();

    // First packaging marked primary.
    const a = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supplyId,
        supplier_id: supplierId,
        name: 'Case of 12',
        units_per_package: 12,
        price_per_package: 18000,
        is_primary: true,
      });
    expect(a.status).toBe(201);
    expect(a.body.data.is_primary).toBe(true);
    expect(a.body.data.price_per_package?.toString()).toBe('18000');

    // Second packaging for the same supply, also marked primary — the first
    // should be demoted automatically by the service.
    const b = await request(app)
      .post('/api/v1/packagings')
      .set(auth)
      .send({
        supply_id: supplyId,
        supplier_id: supplier2.id,
        name: 'Pallet',
        units_per_package: 144,
        is_primary: true,
      });
    expect(b.status).toBe(201);

    const primaries = await prisma.purchasePackaging.findMany({
      where: { supply_id: supplyId, is_primary: true },
    });
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(b.body.data.id);

    // Toggling via PATCH also enforces the invariant.
    const flip = await request(app)
      .patch(`/api/v1/packagings/${a.body.data.id}`)
      .set(auth)
      .send({ is_primary: true });
    expect(flip.status).toBe(200);
    const after = await prisma.purchasePackaging.findMany({
      where: { supply_id: supplyId, is_primary: true },
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(a.body.data.id);
  });
});

describe('DeductionRule CRUD', () => {
  let auth: Record<string, string>;
  let storageId: string;
  beforeEach(async () => {
    const user = await makeUser();
    auth = authHeader(user.id);
    storageId = (await makeStorage()).id;
  });

  it('creates a default rule, updates, lists, and deletes', async () => {
    const create = await request(app)
      .post('/api/v1/deduction-rules')
      .set(auth)
      .send({ storage_id: storageId });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;

    const update = await request(app)
      .patch(`/api/v1/deduction-rules/${id}`)
      .set(auth)
      .send({ station_id: '11111111-1111-1111-1111-111111111111' });
    expect(update.status).toBe(200);

    const list = await request(app)
      .get(`/api/v1/deduction-rules?storage_id=${storageId}`)
      .set(auth);
    expect(list.body.data.items).toHaveLength(1);

    await request(app).delete(`/api/v1/deduction-rules/${id}`).set(auth).expect(204);
  });

  it('rejects a missing storage reference', async () => {
    const res = await request(app)
      .post('/api/v1/deduction-rules')
      .set(auth)
      .send({ storage_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });
});
