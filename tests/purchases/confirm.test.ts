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
  makePackaging,
} from '../helpers/factories.js';

const app = getTestApp();

interface Fixtures {
  userId: string;
  supplierId: string;
  storageId: string;
  bottleSupplyId: string;
  auth: Record<string, string>;
}

async function setupFixtures(): Promise<Fixtures> {
  const [user, supplier, storage, category] = await Promise.all([
    makeUser(),
    makeSupplier({ name: 'Distribuidora Café del Norte' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  return {
    userId: user.id,
    supplierId: supplier.id,
    storageId: storage.id,
    bottleSupplyId: supply.id,
    auth: authHeader(user.id, 'ADMIN'),
  };
}

async function createDraftPurchase(
  f: Fixtures,
  items: Array<{
    supply_id: string;
    packaging_id?: string | null;
    package_quantity: number;
    price_per_package: number;
  }>,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/purchases')
    .set(f.auth)
    .send({
      supplier_id: f.supplierId,
      storage_id: f.storageId,
      date: '2026-04-21T00:00:00Z',
      items,
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('POST /api/v1/purchases/:id/confirm — WAC recalculation', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('computes WAC = $29.20 after buying 12 @ $28 then 18 @ $30', async () => {
    // Purchase 1: 12 bottles at $28 each (2800 centavos per bottle)
    const p1 = await createDraftPurchase(fixtures, [
      {
        supply_id: fixtures.bottleSupplyId,
        packaging_id: null,
        package_quantity: 12,
        price_per_package: 2800,
      },
    ]);
    const confirm1 = await request(app)
      .post(`/api/v1/purchases/${p1}/confirm`)
      .set(fixtures.auth);
    expect(confirm1.status).toBe(200);
    expect(confirm1.body.data.status).toBe('CONFIRMED');

    // After purchase 1: WAC = (0 + 12*2800)/12 = 2800
    let supply = await prisma.supply.findUniqueOrThrow({
      where: { id: fixtures.bottleSupplyId },
    });
    expect(supply.average_cost.toString()).toBe('2800');
    expect(supply.last_cost.toString()).toBe('2800');

    let stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.bottleSupplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('12');

    // Purchase 2: 18 bottles at $30 each (3000 centavos per bottle)
    const p2 = await createDraftPurchase(fixtures, [
      {
        supply_id: fixtures.bottleSupplyId,
        packaging_id: null,
        package_quantity: 18,
        price_per_package: 3000,
      },
    ]);
    const confirm2 = await request(app)
      .post(`/api/v1/purchases/${p2}/confirm`)
      .set(fixtures.auth);
    expect(confirm2.status).toBe(200);

    // After purchase 2: WAC = (12*2800 + 18*3000)/30 = (33600 + 54000)/30 = 87600/30 = 2920
    supply = await prisma.supply.findUniqueOrThrow({ where: { id: fixtures.bottleSupplyId } });
    expect(supply.average_cost.toString()).toBe('2920');
    expect(supply.last_cost.toString()).toBe('3000');

    // Stock is additive across purchases in the same storage
    stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.bottleSupplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('30');

    // Two PURCHASE movements, both reference their respective purchase
    const movements = await prisma.stockMovement.findMany({
      where: { supply_id: fixtures.bottleSupplyId },
      orderBy: { created_at: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]!.type).toBe('PURCHASE');
    expect(movements[0]!.quantity.toString()).toBe('12');
    expect(movements[0]!.unit_cost.toString()).toBe('2800');
    expect(movements[0]!.reference_type).toBe('Purchase');
    expect(movements[0]!.reference_id).toBe(p1);
    expect(movements[1]!.quantity.toString()).toBe('18');
    expect(movements[1]!.unit_cost.toString()).toBe('3000');
    expect(movements[1]!.reference_id).toBe(p2);

    // Purchase totals are stored in centavos
    const purchases = await prisma.purchase.findMany({ orderBy: { created_at: 'asc' } });
    expect(purchases[0]!.total.toString()).toBe('33600');
    expect(purchases[1]!.total.toString()).toBe('54000');
  });

  it('auto-creates StorageStock on first receipt', async () => {
    // No StorageStock row exists before the purchase confirms.
    const before = await prisma.storageStock.findMany({
      where: { supply_id: fixtures.bottleSupplyId },
    });
    expect(before).toHaveLength(0);

    const purchaseId = await createDraftPurchase(fixtures, [
      {
        supply_id: fixtures.bottleSupplyId,
        packaging_id: null,
        package_quantity: 5,
        price_per_package: 2500,
      },
    ]);
    await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth).expect(200);

    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.bottleSupplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('5');
  });

  it('resolves packaging into base units and unit cost', async () => {
    // Buy 2 boxes of 6 bottles at 15000 centavos per box:
    //   base_unit_quantity = 2 * 6 = 12 bottles
    //   unit_cost         = 15000 / 6 = 2500 per bottle
    const packaging = await makePackaging({
      supply_id: fixtures.bottleSupplyId,
      supplier_id: fixtures.supplierId,
      name: 'Box of 6 bottles',
      units_per_package: 6,
    });
    const purchaseId = await createDraftPurchase(fixtures, [
      {
        supply_id: fixtures.bottleSupplyId,
        packaging_id: packaging.id,
        package_quantity: 2,
        price_per_package: 15000,
      },
    ]);
    await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth).expect(200);

    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.bottleSupplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('12');

    const supply = await prisma.supply.findUniqueOrThrow({
      where: { id: fixtures.bottleSupplyId },
    });
    expect(supply.average_cost.toString()).toBe('2500');
    expect(supply.last_cost.toString()).toBe('2500');

    const movements = await prisma.stockMovement.findMany({
      where: { supply_id: fixtures.bottleSupplyId },
    });
    expect(movements[0]!.quantity.toString()).toBe('12');
    expect(movements[0]!.unit_cost.toString()).toBe('2500');
  });

  it('rejects confirming an already-confirmed purchase', async () => {
    const purchaseId = await createDraftPurchase(fixtures, [
      {
        supply_id: fixtures.bottleSupplyId,
        package_quantity: 4,
        price_per_package: 2000,
      },
    ]);
    await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth).expect(200);
    const res = await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects confirming a purchase with no items', async () => {
    const purchaseId = await createDraftPurchase(fixtures, []);
    const res = await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth);
    expect(res.status).toBe(400);
  });

  it('rolls back stock and WAC if any item fails mid-transaction', async () => {
    // Seed an existing WAC so we can assert it stays put after a rollback.
    const seed = await createDraftPurchase(fixtures, [
      { supply_id: fixtures.bottleSupplyId, package_quantity: 10, price_per_package: 2500 },
    ]);
    await request(app).post(`/api/v1/purchases/${seed}/confirm`).set(fixtures.auth).expect(200);

    // Build a draft with TWO items — first valid, second references a supply
    // we'll soft-delete before confirm. The valid first item will have already
    // mutated stock and WAC by the time the second item throws, so confirming
    // the whole thing must roll both back for the supply-wide invariants
    // to survive.
    const secondSupply = await makeSupply({ name: 'Almond Milk', base_unit: 'BOTTLE' });
    const draftRes = await request(app)
      .post('/api/v1/purchases')
      .set(fixtures.auth)
      .send({
        supplier_id: fixtures.supplierId,
        storage_id: fixtures.storageId,
        date: '2026-04-21T00:00:00Z',
        items: [
          {
            supply_id: fixtures.bottleSupplyId,
            package_quantity: 5,
            price_per_package: 4000,
          },
          {
            supply_id: secondSupply.id,
            package_quantity: 3,
            price_per_package: 5000,
          },
        ],
      });
    expect(draftRes.status).toBe(201);
    const draftId = draftRes.body.data.id as string;

    // Soft-delete the second supply so confirm() throws mid-loop.
    await prisma.supply.update({
      where: { id: secondSupply.id },
      data: { deleted_at: new Date() },
    });

    const res = await request(app).post(`/api/v1/purchases/${draftId}/confirm`).set(fixtures.auth);
    expect(res.status).toBe(400);

    // Seeded values intact:
    const supply = await prisma.supply.findUniqueOrThrow({
      where: { id: fixtures.bottleSupplyId },
    });
    expect(supply.average_cost.toString()).toBe('2500');
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: fixtures.bottleSupplyId, storage_id: fixtures.storageId },
    });
    expect(stock.quantity.toString()).toBe('10');

    // Second supply: no stock row created, no WAC movement
    const secondStocks = await prisma.storageStock.findMany({
      where: { supply_id: secondSupply.id },
    });
    expect(secondStocks).toHaveLength(0);

    // Exactly ONE movement (the seed purchase) — the failed confirm wrote none.
    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]!.reference_id).toBe(seed);

    const draftAfter = await prisma.purchase.findUniqueOrThrow({ where: { id: draftId } });
    expect(draftAfter.status).toBe('DRAFT');
  });

  it('WAC updates across storages for the same supply', async () => {
    // Confirm the first purchase into Bodega.
    const p1 = await createDraftPurchase(fixtures, [
      { supply_id: fixtures.bottleSupplyId, package_quantity: 12, price_per_package: 2800 },
    ]);
    await request(app).post(`/api/v1/purchases/${p1}/confirm`).set(fixtures.auth).expect(200);

    // Second purchase lands in a different storage — WAC still tracks supply-wide totals.
    const barra = await makeStorage({ name: 'Barra' });
    const res = await request(app).post('/api/v1/purchases').set(fixtures.auth).send({
      supplier_id: fixtures.supplierId,
      storage_id: barra.id,
      date: '2026-04-21T00:00:00Z',
      items: [
        { supply_id: fixtures.bottleSupplyId, package_quantity: 18, price_per_package: 3000 },
      ],
    });
    expect(res.status).toBe(201);
    const p2 = res.body.data.id as string;
    await request(app).post(`/api/v1/purchases/${p2}/confirm`).set(fixtures.auth).expect(200);

    const supply = await prisma.supply.findUniqueOrThrow({
      where: { id: fixtures.bottleSupplyId },
    });
    expect(supply.average_cost.toString()).toBe('2920');

    const stocks = await prisma.storageStock.findMany({
      where: { supply_id: fixtures.bottleSupplyId },
      orderBy: { quantity: 'asc' },
    });
    expect(stocks).toHaveLength(2);
    expect(stocks[0]!.quantity.toString()).toBe('12'); // Bodega
    expect(stocks[1]!.quantity.toString()).toBe('18'); // Barra
  });
});

describe('Purchase lifecycle guards', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('rejects item mutations after confirm', async () => {
    const purchaseId = await createDraftPurchase(fixtures, [
      { supply_id: fixtures.bottleSupplyId, package_quantity: 1, price_per_package: 100 },
    ]);
    await request(app).post(`/api/v1/purchases/${purchaseId}/confirm`).set(fixtures.auth).expect(200);

    const addRes = await request(app)
      .post(`/api/v1/purchases/${purchaseId}/items`)
      .set(fixtures.auth)
      .send({
        supply_id: fixtures.bottleSupplyId,
        package_quantity: 1,
        price_per_package: 100,
      });
    expect(addRes.status).toBe(409);
  });

  it('updates total when items are added or removed', async () => {
    const purchaseId = await createDraftPurchase(fixtures, []);

    await request(app)
      .post(`/api/v1/purchases/${purchaseId}/items`)
      .set(fixtures.auth)
      .send({ supply_id: fixtures.bottleSupplyId, package_quantity: 2, price_per_package: 1000 })
      .expect(201);

    let purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(purchase.total.toString()).toBe('2000');

    const addRes = await request(app)
      .post(`/api/v1/purchases/${purchaseId}/items`)
      .set(fixtures.auth)
      .send({ supply_id: fixtures.bottleSupplyId, package_quantity: 3, price_per_package: 500 });
    expect(addRes.status).toBe(201);

    purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(purchase.total.toString()).toBe('3500');

    await request(app)
      .delete(`/api/v1/purchases/${purchaseId}/items/${addRes.body.data.id}`)
      .set(fixtures.auth)
      .expect(204);

    purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(purchase.total.toString()).toBe('2000');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/purchases');
    expect(res.status).toBe(401);
  });
});
