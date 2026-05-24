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
  cashier: { id: string; auth: Record<string, string> };
  manager: { id: string; auth: Record<string, string> };
  supplierId: string;
  storageId: string;
  supplyAId: string;
  supplyBId: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const [cashier, manager, supplier, storage, category] = await Promise.all([
    makeUser({ role: 'CASHIER' }),
    makeUser({ role: 'MANAGER' }),
    makeSupplier({ name: 'Frialsa' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Cold' }),
  ]);
  const [supplyA, supplyB] = await Promise.all([
    makeSupply({ category_id: category.id, name: 'Ice block 5kg', base_unit: 'PIECE' }),
    makeSupply({ category_id: category.id, name: 'Dry ice 3kg', base_unit: 'PIECE' }),
  ]);
  // Mark supplier as DELIVERY explicitly so the create endpoint infers
  // PurchaseKind.DELIVERY for ambiguous requests.
  await prisma.supplier.update({ where: { id: supplier.id }, data: { kind: 'DELIVERY' } });
  return {
    cashier: { id: cashier.id, auth: authHeader(cashier.id, 'CASHIER') },
    manager: { id: manager.id, auth: authHeader(manager.id, 'MANAGER') },
    supplierId: supplier.id,
    storageId: storage.id,
    supplyAId: supplyA.id,
    supplyBId: supplyB.id,
  };
}

describe('Delivery purchase lifecycle — happy path', () => {
  let f: Fixtures;
  beforeEach(async () => {
    f = await setupFixtures();
  });

  it('walks DRAFT → SENT → REPLIED → PAID → IN_TRANSIT → ARRIVED → VERIFIED', async () => {
    // 1. Cashier drafts a delivery with 2 lines
    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T10:00:00Z',
        kind: 'DELIVERY',
        items: [
          { supply_id: f.supplyAId, package_quantity: 4, price_per_package: 12000 },
          { supply_id: f.supplyBId, package_quantity: 2, price_per_package: 8000 },
        ],
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id as string;
    expect(createRes.body.data.kind).toBe('DELIVERY');
    expect(createRes.body.data.status).toBe('DRAFT');

    // 2. /send → SENT_TO_SUPPLIER
    const sendRes = await request(app)
      .post(`/api/v1/purchases/${id}/send`)
      .set(f.cashier.auth);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.status).toBe('SENT_TO_SUPPLIER');
    expect(sendRes.body.data.message_sent_at).toBeTruthy();

    // No stock should have moved yet — verify the supply still shows zero.
    let stocks = await prisma.storageStock.findMany({
      where: { supply_id: f.supplyAId },
    });
    expect(stocks).toHaveLength(0);

    // 3. /reply — supplier accepted with their own subtotal/shipping and
    // marked the second item unavailable.
    const itemIds = createRes.body.data.items.map((it: { id: string }) => it.id) as string[];
    const replyRes = await request(app)
      .post(`/api/v1/purchases/${id}/reply`)
      .set(f.cashier.auth)
      .send({
        supplier_subtotal: 48000,
        shipping_cost: 5000,
        items: [{ id: itemIds[1], unavailable: true }],
      });
    expect(replyRes.status).toBe(200);
    expect(replyRes.body.data.status).toBe('SUPPLIER_REPLIED');
    expect(replyRes.body.data.supplier_subtotal).toBe('48000');
    expect(replyRes.body.data.shipping_cost).toBe('5000');
    const itemB = replyRes.body.data.items.find((it: { id: string }) => it.id === itemIds[1]);
    expect(itemB.unavailable).toBe(true);

    // 4. /pay → PAID with reference
    const payRes = await request(app)
      .post(`/api/v1/purchases/${id}/pay`)
      .set(f.cashier.auth)
      .send({ payment_reference: 'TRF-12345' });
    expect(payRes.status).toBe(200);
    expect(payRes.body.data.status).toBe('PAID');
    expect(payRes.body.data.payment_reference).toBe('TRF-12345');
    expect(payRes.body.data.paid_at).toBeTruthy();

    // 5. /in-transit
    const inTransitRes = await request(app)
      .post(`/api/v1/purchases/${id}/in-transit`)
      .set(f.cashier.auth)
      .send({ expected_arrival: '2026-05-25T15:00:00Z' });
    expect(inTransitRes.status).toBe(200);
    expect(inTransitRes.body.data.status).toBe('IN_TRANSIT');

    // 6. /receive — cashier captures what arrived. Item A received in full,
    // item B was unavailable so received 0.
    const receiveRes = await request(app)
      .post(`/api/v1/purchases/${id}/receive`)
      .set(f.cashier.auth)
      .send({
        items: [
          { id: itemIds[0], received_package_quantity: 4 },
          { id: itemIds[1], received_package_quantity: 0, shortfall_reason: 'out_of_stock' },
        ],
      });
    expect(receiveRes.status).toBe(200);
    expect(receiveRes.body.data.status).toBe('ARRIVED');

    // Still no stock movement before verify — that's the manager+ step.
    stocks = await prisma.storageStock.findMany({ where: { supply_id: f.supplyAId } });
    expect(stocks).toHaveLength(0);

    // 7. /verify (manager+ only) — flips to VERIFIED + absorbs stock + WAC.
    const verifyRes = await request(app)
      .post(`/api/v1/purchases/${id}/verify`)
      .set(f.manager.auth)
      .send({});
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe('VERIFIED');
    expect(verifyRes.body.data.verified_at).toBeTruthy();
    expect(verifyRes.body.data.verifier?.id).toBe(f.manager.id);

    // Item A absorbed: 4 packages × 1 unit each = 4 base units, unit_cost
    // = price / units_per_package = 12000 / 1 = 12000.
    const stockA = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: f.supplyAId, storage_id: f.storageId },
    });
    expect(stockA.quantity.toString()).toBe('4');
    const supplyA = await prisma.supply.findUniqueOrThrow({ where: { id: f.supplyAId } });
    expect(supplyA.average_cost.toString()).toBe('12000');
    expect(supplyA.last_cost.toString()).toBe('12000');

    // Item B unavailable / received 0 — no stock row should exist.
    const stocksB = await prisma.storageStock.findMany({ where: { supply_id: f.supplyBId } });
    expect(stocksB).toHaveLength(0);

    // Exactly one StockMovement, for item A only.
    const movements = await prisma.stockMovement.findMany({
      where: { reference_type: 'Purchase', reference_id: id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.supply_id).toBe(f.supplyAId);
    expect(movements[0]!.quantity.toString()).toBe('4');
    expect(movements[0]!.unit_cost.toString()).toBe('12000');
  });

  it('rejects an out-of-order transition (DRAFT → /pay)', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T10:00:00Z',
        kind: 'DELIVERY',
        items: [{ supply_id: f.supplyAId, package_quantity: 1, price_per_package: 1000 }],
      });
    const id = created.body.data.id as string;

    const payRes = await request(app)
      .post(`/api/v1/purchases/${id}/pay`)
      .set(f.cashier.auth)
      .send({});
    expect(payRes.status).toBe(409);
    expect(payRes.body.error.code).toBe('CONFLICT');
  });

  it('rejects /send on an empty draft (nothing to order)', async () => {
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(f.cashier.auth)
      .send({
        supplier_id: f.supplierId,
        storage_id: f.storageId,
        date: '2026-05-24T10:00:00Z',
        kind: 'DELIVERY',
      });
    const id = created.body.data.id as string;

    const sendRes = await request(app)
      .post(`/api/v1/purchases/${id}/send`)
      .set(f.cashier.auth);
    expect(sendRes.status).toBe(400);
  });
});
