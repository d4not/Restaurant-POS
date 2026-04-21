import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
import { deductSaleFromInventory } from '../../src/modules/sales/service.js';
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

// Phase 9A deduction redesign. A SWAP group replaces the recipe's targeted
// ingredient with the modifier's supply at `ratio`; per-product overrides can
// bend the rule further. ADD groups still deduct on top as before.
interface Scenario {
  auth: Record<string, string>;
  barraId: string;
  stationId: string;
  supplyIds: {
    milk: string;
    almond: string;
    espresso: string;
  };
  latteProductId: string;
  latteLargeId: string;
  frappeProductId: string;
  frappeVariantId: string;
  milkSwapGroupId: string;
  wholeMilkModifierId: string;
  almondMilkModifierId: string;
  extrasGroupId: string;
  extraShotModifierId: string;
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

async function seedScenario(): Promise<Scenario> {
  const [user, supplier, barra, dairyCat, coffeeCat] = await Promise.all([
    makeUser(),
    makeSupplier(),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Dairy' }),
    makeSupplyCategory({ name: 'Coffee' }),
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

  await buyInto(auth, supplier.id, barra.id, milk.id, 10, 3000);
  await buyInto(auth, supplier.id, barra.id, almond.id, 5, 5000);
  await buyInto(auth, supplier.id, barra.id, espresso.id, 2, 40000);

  const category = await request(app)
    .post('/api/v1/product-categories')
    .set(auth)
    .send({ name: 'Hot Coffee' })
    .expect(201);

  // Latte DISH with a Large variant whose recipe uses 200ml Whole Milk.
  const latte = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: category.body.data.id,
    sell_price: 7500,
  });
  const latteProductId = latte.body.data.id as string;
  const latteLarge = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Large 16oz', sell_price: 7500 })
    .expect(201);
  const latteLargeId = latteLarge.body.data.id as string;
  await request(app)
    .post(`/api/v1/recipes/variants/${latteLargeId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 200, unit: 'ml' },
        { supply_id: espresso.id, quantity: 18, unit: 'g' },
      ],
    })
    .expect(201);

  // Frappe — a second DISH so per-product overrides have somewhere to attach.
  const frappe = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Frappe',
    type: 'DISH',
    category_id: category.body.data.id,
    sell_price: 8500,
  });
  const frappeProductId = frappe.body.data.id as string;
  const frappeVariant = await request(app)
    .post(`/api/v1/products/${frappeProductId}/variants`)
    .set(auth)
    .send({ name: 'Regular', sell_price: 8500 })
    .expect(201);
  const frappeVariantId = frappeVariant.body.data.id as string;
  await request(app)
    .post(`/api/v1/recipes/variants/${frappeVariantId}`)
    .set(auth)
    .send({
      items: [
        { supply_id: milk.id, quantity: 150, unit: 'ml' },
        { supply_id: espresso.id, quantity: 18, unit: 'g' },
      ],
    })
    .expect(201);

  // SWAP group: Milk Type, replacing Whole Milk.
  const milkGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Milk Type',
    type: 'SWAP',
    replaces_supply_id: milk.id,
    min_selection: 0,
    max_selection: 1,
  });
  expect(milkGroup.status).toBe(201);
  const milkSwapGroupId = milkGroup.body.data.id as string;

  // Whole Milk ratio 1.0 — selecting it is a no-op (swap in the same milk).
  const wholeMilk = await request(app)
    .post(`/api/v1/modifier-groups/${milkSwapGroupId}/modifiers`)
    .set(auth)
    .send({
      name: 'Whole Milk',
      extra_price: 0,
      supply_id: milk.id,
      ratio: 1,
    });
  expect(wholeMilk.status).toBe(201);
  const wholeMilkModifierId = wholeMilk.body.data.id as string;

  // Almond Milk ratio 0.75 — 200ml recipe → 150ml almond milk deducted.
  const almondMilk = await request(app)
    .post(`/api/v1/modifier-groups/${milkSwapGroupId}/modifiers`)
    .set(auth)
    .send({
      name: 'Almond Milk',
      extra_price: 1000,
      supply_id: almond.id,
      ratio: 0.75,
    });
  expect(almondMilk.status).toBe(201);
  const almondMilkModifierId = almondMilk.body.data.id as string;

  // ADD group (unchanged behavior).
  const extrasGroup = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Extras',
    type: 'ADD',
    min_selection: 0,
    max_selection: 3,
  });
  expect(extrasGroup.status).toBe(201);
  const extrasGroupId = extrasGroup.body.data.id as string;
  const extraShot = await request(app)
    .post(`/api/v1/modifier-groups/${extrasGroupId}/modifiers`)
    .set(auth)
    .send({
      name: 'Extra Shot',
      extra_price: 1500,
      supply_id: espresso.id,
      supply_quantity: 18,
      supply_unit: 'g',
    });
  expect(extraShot.status).toBe(201);
  const extraShotModifierId = extraShot.body.data.id as string;

  // Attach groups to both DISH products.
  for (const productId of [latteProductId, frappeProductId]) {
    await request(app)
      .post(`/api/v1/products/${productId}/modifier-groups`)
      .set(auth)
      .send({ modifier_group_id: milkSwapGroupId })
      .expect(201);
    await request(app)
      .post(`/api/v1/products/${productId}/modifier-groups`)
      .set(auth)
      .send({ modifier_group_id: extrasGroupId })
      .expect(201);
  }

  const stationId = randomUUID();
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ station_id: stationId, storage_id: barra.id })
    .expect(201);

  return {
    auth,
    barraId: barra.id,
    stationId,
    supplyIds: { milk: milk.id, almond: almond.id, espresso: espresso.id },
    latteProductId,
    latteLargeId,
    frappeProductId,
    frappeVariantId,
    milkSwapGroupId,
    wholeMilkModifierId,
    almondMilkModifierId,
    extrasGroupId,
    extraShotModifierId,
  };
}

function expectClose(actual: Decimal, expected: Decimal, tolerance = '0.0001'): void {
  const diff = actual.sub(expected).abs();
  expect(diff.lte(new Decimal(tolerance))).toBe(true);
}

async function stockAt(supplyId: string, storageId: string): Promise<Decimal> {
  const row = await prisma.storageStock.findUniqueOrThrow({
    where: { supply_id_storage_id: { supply_id: supplyId, storage_id: storageId } },
  });
  return new Decimal(row.quantity);
}

describe('Phase 9A — SWAP modifier replaces a recipe ingredient at ratio', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('swaps whole milk for almond milk at ratio 0.75 — whole milk NOT deducted, 150ml almond milk deducted', async () => {
    const before = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
    };

    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId],
        },
      ],
      s.stationId,
      randomUUID(),
    );

    const after = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
    };

    // Whole milk: untouched. Recipe line was skipped entirely.
    expect(after.milk.equals(before.milk)).toBe(true);
    // Almond milk: 200ml recipe × 0.75 = 150ml → 0.15 bottles (1L bottle).
    expectClose(before.almond.sub(after.almond), new Decimal('0.15'));
  });

  it('whole milk at ratio 1.0 deducts the same amount as the original recipe', async () => {
    // Selecting "Whole Milk" from a SWAP group replaces the recipe's whole milk
    // with itself at ratio 1.0 — functionally identical to leaving the default.
    const before = await stockAt(s.supplyIds.milk, s.barraId);

    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [s.wholeMilkModifierId],
        },
      ],
      s.stationId,
      randomUUID(),
    );

    const after = await stockAt(s.supplyIds.milk, s.barraId);
    // 200ml / 946ml per bottle.
    expectClose(before.sub(after), new Decimal(200).div(946));
  });

  it('with no SWAP modifier selected, the recipe deducts the original ingredient normally', async () => {
    const before = await stockAt(s.supplyIds.milk, s.barraId);

    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [],
        },
      ],
      s.stationId,
      randomUUID(),
    );

    const after = await stockAt(s.supplyIds.milk, s.barraId);
    expectClose(before.sub(after), new Decimal(200).div(946));
  });
});

describe('Phase 9A — ADD modifier stacks on top of the recipe', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('extra shot ADDs 18g espresso on top of the recipe\'s 18g = 36g total', async () => {
    const before = await stockAt(s.supplyIds.espresso, s.barraId);

    const orderId = randomUUID();
    const result = await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [s.extraShotModifierId],
        },
      ],
      s.stationId,
      orderId,
    );

    const after = await stockAt(s.supplyIds.espresso, s.barraId);
    // 18g recipe + 18g extra shot = 36g → 0.036 bags.
    expectClose(before.sub(after), new Decimal('0.036'));

    // Single aggregated SALE movement for espresso (recipe + modifier merged).
    const movements = await prisma.stockMovement.findMany({
      where: { reference_id: orderId, type: 'SALE', supply_id: s.supplyIds.espresso },
    });
    expect(movements).toHaveLength(1);
    expect(new Decimal(movements[0]!.quantity).abs().toString()).toBe('0.036');
    expect(result.warnings).toEqual([]);
  });
});

describe('Phase 9A — per-product overrides change the SWAP deduction amount', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('FIXED_QTY override deducts the configured amount regardless of the recipe', async () => {
    // Frappe's recipe has 150ml whole milk. Override says: Almond Milk on
    // Frappe = 90ml fixed. Deduction should be exactly 90ml → 0.09 bottles,
    // ignoring the 150ml recipe quantity entirely.
    await prisma.modifierProductOverride.create({
      data: {
        product_id: s.frappeProductId,
        modifier_id: s.almondMilkModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 90,
        override_unit: 'ml',
      },
    });

    const before = await stockAt(s.supplyIds.almond, s.barraId);
    await deductSaleFromInventory(
      [
        {
          product_id: s.frappeProductId,
          variant_id: s.frappeVariantId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId],
        },
      ],
      s.stationId,
      randomUUID(),
    );
    const after = await stockAt(s.supplyIds.almond, s.barraId);
    expectClose(before.sub(after), new Decimal('0.09'));

    // Whole milk still skipped (recipe line replaced).
    const movements = await prisma.stockMovement.findMany({
      where: { type: 'SALE', supply_id: s.supplyIds.milk },
    });
    expect(movements).toHaveLength(0);
  });

  it('RATIO override uses the per-product ratio instead of the modifier default', async () => {
    // Default Almond Milk ratio is 0.75. Override sets it to 0.60 for Frappe
    // so the 150ml recipe → 90ml deducted instead of 112.5ml.
    await prisma.modifierProductOverride.create({
      data: {
        product_id: s.frappeProductId,
        modifier_id: s.almondMilkModifierId,
        override_type: 'RATIO',
        override_ratio: '0.60',
      },
    });

    const before = await stockAt(s.supplyIds.almond, s.barraId);
    await deductSaleFromInventory(
      [
        {
          product_id: s.frappeProductId,
          variant_id: s.frappeVariantId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId],
        },
      ],
      s.stationId,
      randomUUID(),
    );
    const after = await stockAt(s.supplyIds.almond, s.barraId);
    // 150ml × 0.60 = 90ml → 0.09 bottles.
    expectClose(before.sub(after), new Decimal('0.09'));
  });

  it('different products use different ratios side-by-side (override only affects the overridden product)', async () => {
    // Override on Frappe → 0.60. Latte still uses the default 0.75. One order
    // with both lines — the numbers should differ per product.
    await prisma.modifierProductOverride.create({
      data: {
        product_id: s.frappeProductId,
        modifier_id: s.almondMilkModifierId,
        override_type: 'RATIO',
        override_ratio: '0.60',
      },
    });

    const before = await stockAt(s.supplyIds.almond, s.barraId);
    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId],
        },
        {
          product_id: s.frappeProductId,
          variant_id: s.frappeVariantId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId],
        },
      ],
      s.stationId,
      randomUUID(),
    );
    const after = await stockAt(s.supplyIds.almond, s.barraId);
    // Latte 200ml × 0.75 = 150ml, Frappe 150ml × 0.60 = 90ml.
    // Total 240ml → 0.24 bottles (1L bottle).
    expectClose(before.sub(after), new Decimal('0.24'));
  });
});
