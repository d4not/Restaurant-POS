import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
import { deductSaleFromInventory } from '../../src/modules/sales/service.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeSupplier,
  makeSupplyCategory,
  makeStorage,
  makeSupply,
} from '../helpers/factories.js';

const app = getTestApp();

// Scenario driven end-to-end via the HTTP API so the sale deduction exercises
// the same supply/recipe/modifier plumbing a real POS would hit:
//
//   1× Latte Grande (variant recipe: 200ml milk + 18g espresso + 30ml simple syrup)
//       + modifier "Almond Milk" (200ml almond milk)
//       + modifier "Extra Shot"  (9g espresso beans)
//   1× Bottled Water (PRODUCT — deducts 1 supply unit directly)
//
// A DeductionRule ties the café's "bar station" to the "Barra" storage, so
// every line — recipe ingredient, preparation, modifier, packaged product —
// must land there.

interface Seed {
  auth: Record<string, string>;
  bodegaId: string;
  barraId: string;
  supplyIds: {
    milk: string;
    almondMilk: string;
    espresso: string;
    sugar: string;
    water: string;
  };
  latteProductId: string;
  latteVariantId: string;
  simpleSyrupProductId: string;
  almondMilkModifierId: string;
  extraShotModifierId: string;
  waterProductId: string;
  stationId: string;
}

async function buyInto(
  auth: Record<string, string>,
  supplierId: string,
  storageId: string,
  supplyId: string,
  packageQuantity: number,
  pricePerPackage: number,
): Promise<void> {
  const draft = await request(app).post('/api/v1/purchases').set(auth).send({
    supplier_id: supplierId,
    storage_id: storageId,
    date: '2026-04-21T00:00:00Z',
    items: [
      {
        supply_id: supplyId,
        packaging_id: null,
        package_quantity: packageQuantity,
        price_per_package: pricePerPackage,
      },
    ],
  });
  expect(draft.status).toBe(201);
  await request(app)
    .post(`/api/v1/purchases/${draft.body.data.id}/confirm`)
    .set(auth)
    .expect(200);
}

async function seedScenario(): Promise<Seed> {
  const [user, supplier, bodega, barra, dairyCat, coffeeCat, sweetCat, waterCat] =
    await Promise.all([
      makeUser(),
      makeSupplier({ name: 'Distribuidora Café del Norte' }),
      makeStorage({ name: 'Bodega' }),
      makeStorage({ name: 'Barra' }),
      makeSupplyCategory({ name: 'Dairy' }),
      makeSupplyCategory({ name: 'Coffee' }),
      makeSupplyCategory({ name: 'Sweeteners' }),
      makeSupplyCategory({ name: 'Bottled Drinks' }),
    ]);
  const auth = authHeader(user.id);

  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const almond = await makeSupply({
    category_id: dairyCat.id,
    name: 'Almond Milk 1L',
    base_unit: 'BOTTLE',
    content_per_unit: 1000,
    content_unit: 'ML',
  });
  const espresso = await makeSupply({
    category_id: coffeeCat.id,
    name: 'Espresso Beans 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });
  const sugar = await makeSupply({
    category_id: sweetCat.id,
    name: 'Sugar 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });
  const water = await makeSupply({
    category_id: waterCat.id,
    name: 'Bottled Water 500ml',
    base_unit: 'BOTTLE',
    content_per_unit: 500,
    content_unit: 'ML',
  });

  // Purchase directly into Barra so the rule-matched storage has stock.
  await buyInto(auth, supplier.id, barra.id, milk.id, 10, 3000);
  await buyInto(auth, supplier.id, barra.id, almond.id, 5, 5000);
  await buyInto(auth, supplier.id, barra.id, espresso.id, 2, 40000);
  await buyInto(auth, supplier.id, barra.id, sugar.id, 2, 2000);
  await buyInto(auth, supplier.id, barra.id, water.id, 24, 1200);

  const waterProduct = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Bottled Water',
    type: 'PRODUCT',
    sell_price: 2500,
    supply_id: water.id,
  });
  expect(waterProduct.status).toBe(201);

  const prep = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Simple Syrup',
    type: 'PREPARATION',
  });
  expect(prep.status).toBe(201);
  const simpleSyrupProductId = prep.body.data.id as string;
  await request(app)
    .post(`/api/v1/recipes/products/${simpleSyrupProductId}`)
    .set(auth)
    .send({
      yield_quantity: 150,
      yield_unit: 'ml',
      items: [{ supply_id: sugar.id, quantity: 100, unit: 'g' }],
    })
    .expect(201);

  const category = await request(app).post('/api/v1/product-categories').set(auth).send({
    name: 'Hot Coffee',
  });
  expect(category.status).toBe(201);

  const latte = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: category.body.data.id,
    sell_price: 6500,
  });
  expect(latte.status).toBe(201);
  const latteProductId = latte.body.data.id as string;

  const variant = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Grande 16oz', sell_price: 6500 });
  expect(variant.status).toBe(201);
  const latteVariantId = variant.body.data.id as string;

  await request(app)
    .post(`/api/v1/recipes/variants/${latteVariantId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 200, unit: 'ml' },
        { supply_id: espresso.id, quantity: 18, unit: 'g' },
        { preparation_id: simpleSyrupProductId, quantity: 30, unit: 'ml' },
      ],
    })
    .expect(201);

  const milkGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Milk Type',
    min_selection: 0,
    max_selection: 1,
  });
  expect(milkGroup.status).toBe(201);
  const almondMod = await request(app)
    .post(`/api/v1/modifier-groups/${milkGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Almond Milk',
      extra_price: 1000,
      supply_id: almond.id,
      supply_quantity: 200,
      supply_unit: 'ml',
    });
  expect(almondMod.status).toBe(201);
  const almondMilkModifierId = almondMod.body.data.id as string;

  const extrasGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Extras',
    min_selection: 0,
    max_selection: 3,
  });
  expect(extrasGroup.status).toBe(201);
  const extraShot = await request(app)
    .post(`/api/v1/modifier-groups/${extrasGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Extra Shot',
      extra_price: 1500,
      supply_id: espresso.id,
      supply_quantity: 9,
      supply_unit: 'g',
    });
  expect(extraShot.status).toBe(201);
  const extraShotModifierId = extraShot.body.data.id as string;

  await request(app)
    .post(`/api/v1/products/${latteProductId}/modifier-groups`)
    .set(auth)
    .send({ modifier_group_id: milkGroup.body.data.id })
    .expect(201);
  await request(app)
    .post(`/api/v1/products/${latteProductId}/modifier-groups`)
    .set(auth)
    .send({ modifier_group_id: extrasGroup.body.data.id })
    .expect(201);

  const stationId = randomUUID();
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ station_id: stationId, storage_id: barra.id })
    .expect(201);

  return {
    auth,
    bodegaId: bodega.id,
    barraId: barra.id,
    supplyIds: {
      milk: milk.id,
      almondMilk: almond.id,
      espresso: espresso.id,
      sugar: sugar.id,
      water: water.id,
    },
    latteProductId,
    latteVariantId,
    simpleSyrupProductId,
    almondMilkModifierId,
    extraShotModifierId,
    waterProductId: waterProduct.body.data.id as string,
    stationId,
  };
}

function expectClose(actual: Decimal, expected: Decimal, tolerance = '0.0001'): void {
  const diff = actual.sub(expected).abs();
  expect(diff.lte(new Decimal(tolerance))).toBe(true);
}

describe('deductSaleFromInventory — complex café sale', () => {
  let seed: Seed;

  beforeEach(async () => {
    seed = await seedScenario();
  });

  it('deducts every ingredient to Barra for a Latte+modifiers and a Bottled Water', async () => {
    const orderId = randomUUID();

    const result = await deductSaleFromInventory(
      [
        {
          product_id: seed.latteProductId,
          variant_id: seed.latteVariantId,
          quantity: 1,
          modifier_ids: [seed.almondMilkModifierId, seed.extraShotModifierId],
        },
        { product_id: seed.waterProductId, quantity: 1 },
      ],
      seed.stationId,
      orderId,
    );

    expect(result.order_id).toBe(orderId);
    expect(result.warnings).toEqual([]);
    // 5 distinct supplies: milk, almond milk, espresso, sugar, water.
    expect(result.deductions).toHaveLength(5);
    for (const d of result.deductions) {
      expect(d.storage_id).toBe(seed.barraId);
      expect(d.went_negative).toBe(false);
    }

    const stocks = await prisma.storageStock.findMany({
      where: { storage_id: seed.barraId },
    });
    const byId = new Map(stocks.map((s) => [s.supply_id, s]));

    // Milk: 10 bottles − 200ml/946ml per bottle = 10 − 200/946
    expectClose(
      new Decimal(byId.get(seed.supplyIds.milk)!.quantity),
      new Decimal(10).sub(new Decimal(200).div(946)),
    );

    // Almond milk: 5 bottles − 200ml/1000ml = 4.8
    expectClose(
      new Decimal(byId.get(seed.supplyIds.almondMilk)!.quantity),
      new Decimal('4.8'),
    );

    // Espresso: 2 bags − (18g recipe + 9g extra shot) / 1000g = 2 − 0.027
    expectClose(
      new Decimal(byId.get(seed.supplyIds.espresso)!.quantity),
      new Decimal(2).sub(new Decimal(27).div(1000)),
    );

    // Sugar: simple syrup prep yields 150ml per 100g; 30ml of latte uses 20g.
    // 2 bags − 20g/1000g = 1.98
    expectClose(
      new Decimal(byId.get(seed.supplyIds.sugar)!.quantity),
      new Decimal('1.98'),
    );

    // Water: 24 bottles − 1 = 23 (PRODUCT path, straight unit deduction)
    expect(byId.get(seed.supplyIds.water)!.quantity.toString()).toBe('23');

    // Exactly one SALE movement per supply, all referencing the order.
    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', reference_id: orderId },
      orderBy: { supply_id: 'asc' },
    });
    expect(movements).toHaveLength(5);
    for (const m of movements) {
      expect(m.reference_type).toBe('Order');
      expect(m.storage_id).toBe(seed.barraId);
      expect(new Decimal(m.quantity).isNegative()).toBe(true);
      // unit_cost snapshots the supply's WAC at the time of sale.
      expect(new Decimal(m.unit_cost).gt(0)).toBe(true);
    }
  });

  it('aggregates espresso draws from recipe + modifier into a single movement', async () => {
    const orderId = randomUUID();
    await deductSaleFromInventory(
      [
        {
          product_id: seed.latteProductId,
          variant_id: seed.latteVariantId,
          quantity: 1,
          modifier_ids: [seed.extraShotModifierId],
        },
      ],
      seed.stationId,
      orderId,
    );

    const espressoMovements = await prisma.stockMovement.findMany({
      where: {
        type: 'SALE',
        reference_id: orderId,
        supply_id: seed.supplyIds.espresso,
      },
    });
    expect(espressoMovements).toHaveLength(1);
    // 18g base recipe + 9g extra shot = 27g → 0.027 bags deducted
    expectClose(
      new Decimal(espressoMovements[0]!.quantity).abs(),
      new Decimal('0.027'),
    );
  });

  it('scales deductions by line quantity', async () => {
    const orderId = randomUUID();
    await deductSaleFromInventory(
      [{ product_id: seed.waterProductId, quantity: 3 }],
      seed.stationId,
      orderId,
    );

    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: seed.supplyIds.water, storage_id: seed.barraId },
    });
    expect(stock.quantity.toString()).toBe('21');
  });

  it('warns but does not block when stock goes negative', async () => {
    // Drain water to 0 with a huge sale, then sell one more and expect a
    // warning plus a negative balance on storage.
    const drainOrder = randomUUID();
    await deductSaleFromInventory(
      [{ product_id: seed.waterProductId, quantity: 24 }],
      seed.stationId,
      drainOrder,
    );

    const orderId = randomUUID();
    const result = await deductSaleFromInventory(
      [{ product_id: seed.waterProductId, quantity: 1 }],
      seed.stationId,
      orderId,
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.deductions[0]!.went_negative).toBe(true);
    const stock = await prisma.storageStock.findFirstOrThrow({
      where: { supply_id: seed.supplyIds.water, storage_id: seed.barraId },
    });
    expect(stock.quantity.toString()).toBe('-1');
  });

  it('rolls the whole sale back if any line fails', async () => {
    const orderId = randomUUID();

    const stocksBefore = await prisma.storageStock.findMany({
      where: { storage_id: seed.barraId },
      orderBy: { supply_id: 'asc' },
    });

    await expect(
      deductSaleFromInventory(
        [
          // Valid line runs first and would mutate water stock...
          { product_id: seed.waterProductId, quantity: 1 },
          // ...then this bogus line throws NotFoundError, rolling everything back.
          { product_id: randomUUID(), quantity: 1 },
        ],
        seed.stationId,
        orderId,
      ),
    ).rejects.toThrow();

    const stocksAfter = await prisma.storageStock.findMany({
      where: { storage_id: seed.barraId },
      orderBy: { supply_id: 'asc' },
    });
    expect(stocksAfter).toEqual(stocksBefore);

    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', reference_id: orderId },
    });
    expect(movements).toHaveLength(0);
  });

  it('falls back to last-purchase storage when no deduction rule matches', async () => {
    // Wipe the rule so station lookup returns nothing.
    await prisma.deductionRule.deleteMany();
    const orderId = randomUUID();
    const result = await deductSaleFromInventory(
      [{ product_id: seed.waterProductId, quantity: 1 }],
      seed.stationId,
      orderId,
    );
    expect(result.deductions).toHaveLength(1);
    // Barra was the only storage that ever received water, so it's the fallback.
    expect(result.deductions[0]!.storage_id).toBe(seed.barraId);
  });
});
