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

// ============================================================================
// Audit gap coverage — edge cases the initial Phase 9A tests didn't hit.
// ============================================================================

describe('Phase 9A audit — SWAP misconfigurations and edge cases', () => {
  let s: Scenario;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('informational SWAP with no replacement supply ("no milk") skips the recipe line without deducting anything', async () => {
    // Add a "No Milk" modifier to the existing Milk Type group: supply_id=null
    // and ratio defaults to 1 (ignored when there's no replacement supply).
    const noMilk = await prisma.modifier.create({
      data: {
        group_id: s.milkSwapGroupId,
        name: 'No Milk',
        extra_price: 0,
        supply_id: null,
      },
    });

    const before = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
      espresso: await stockAt(s.supplyIds.espresso, s.barraId),
    };

    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [noMilk.id],
        },
      ],
      s.stationId,
      randomUUID(),
    );

    const after = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
      espresso: await stockAt(s.supplyIds.espresso, s.barraId),
    };

    // Milk skipped entirely — untouched.
    expect(after.milk.equals(before.milk)).toBe(true);
    // No substitute supply either.
    expect(after.almond.equals(before.almond)).toBe(true);
    // Other recipe ingredients still deduct normally.
    expectClose(before.espresso.sub(after.espresso), new Decimal(18).div(1000));
  });

  it('two SWAP groups targeting DIFFERENT recipe ingredients both take effect on the same line', async () => {
    // Create an espresso-type SWAP group that swaps espresso for decaf beans.
    const decafCat = await prisma.supplyCategory.create({ data: { name: 'Decaf' } });
    const decaf = await prisma.supply.create({
      data: {
        category_id: decafCat.id,
        name: 'Decaf Beans 1kg',
        base_unit: 'BAG',
        content_per_unit: 1000,
        content_unit: 'G',
      },
    });
    // Seed stock directly so we don't have to round-trip through a purchase.
    await prisma.storageStock.create({
      data: { supply_id: decaf.id, storage_id: s.barraId, quantity: 2 },
    });
    await prisma.supply.update({
      where: { id: decaf.id },
      data: { average_cost: 20000, last_cost: 20000 },
    });

    const beanSwapGroup = await request(app).post('/api/v1/modifier-groups').set(s.auth).send({
      name: 'Bean Type',
      type: 'SWAP',
      replaces_supply_id: s.supplyIds.espresso,
      min_selection: 0,
      max_selection: 1,
    });
    expect(beanSwapGroup.status).toBe(201);
    const decafMod = await request(app)
      .post(`/api/v1/modifier-groups/${beanSwapGroup.body.data.id}/modifiers`)
      .set(s.auth)
      .send({ name: 'Decaf', supply_id: decaf.id, ratio: 1, extra_price: 0 });
    expect(decafMod.status).toBe(201);
    await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-groups`)
      .set(s.auth)
      .send({ modifier_group_id: beanSwapGroup.body.data.id })
      .expect(201);

    const before = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
      espresso: await stockAt(s.supplyIds.espresso, s.barraId),
      decaf: await stockAt(decaf.id, s.barraId),
    };

    await deductSaleFromInventory(
      [
        {
          product_id: s.latteProductId,
          variant_id: s.latteLargeId,
          quantity: 1,
          modifier_ids: [s.almondMilkModifierId, decafMod.body.data.id],
        },
      ],
      s.stationId,
      randomUUID(),
    );

    const after = {
      milk: await stockAt(s.supplyIds.milk, s.barraId),
      almond: await stockAt(s.supplyIds.almond, s.barraId),
      espresso: await stockAt(s.supplyIds.espresso, s.barraId),
      decaf: await stockAt(decaf.id, s.barraId),
    };

    // Both recipe ingredients were skipped.
    expect(after.milk.equals(before.milk)).toBe(true);
    expect(after.espresso.equals(before.espresso)).toBe(true);
    // And both substitutes were drawn: 200ml × 0.75 = 0.15 bottles almond,
    // 18g × 1.0 = 0.018 bags decaf.
    expectClose(before.almond.sub(after.almond), new Decimal('0.15'));
    expectClose(before.decaf.sub(after.decaf), new Decimal('0.018'));
  });

  it('two SWAP modifiers targeting the SAME ingredient on one line are rejected (double-substitution prevented)', async () => {
    // Create a second milk substitute (Oat Milk) on the existing Milk Type
    // group, then widen max_selection to 2 directly in the DB to simulate a
    // misconfigured group (business-wise, a single milk choice should be one
    // option, but guard against the data shape just in case).
    const oatMilk = await prisma.supply.create({
      data: {
        category_id: (await prisma.supplyCategory.findFirstOrThrow({ where: { name: 'Dairy' } })).id,
        name: 'Oat Milk 1L',
        base_unit: 'BOTTLE',
        content_per_unit: 1000,
        content_unit: 'ML',
      },
    });
    await prisma.storageStock.create({
      data: { supply_id: oatMilk.id, storage_id: s.barraId, quantity: 3 },
    });
    const oatMod = await prisma.modifier.create({
      data: {
        group_id: s.milkSwapGroupId,
        name: 'Oat Milk',
        extra_price: 1000,
        supply_id: oatMilk.id,
        ratio: 1,
      },
    });
    await prisma.modifierGroup.update({
      where: { id: s.milkSwapGroupId },
      data: { max_selection: 2 },
    });

    await expect(
      deductSaleFromInventory(
        [
          {
            product_id: s.latteProductId,
            variant_id: s.latteLargeId,
            quantity: 1,
            modifier_ids: [s.almondMilkModifierId, oatMod.id],
          },
        ],
        s.stationId,
        randomUUID(),
      ),
    ).rejects.toThrow(/Multiple SWAP modifiers.*target the same ingredient/);
  });

  it('SWAP targeting a supply that the recipe does not use at the top level is rejected', async () => {
    // Create a Syrup SWAP group (replaces a syrup supply), attach it to Latte
    // even though Latte's recipe has no syrup line. Ordering Latte with a
    // syrup swap should error loudly instead of silently no-op'ing.
    const syrupCat = await prisma.supplyCategory.create({ data: { name: 'Syrups' } });
    const vanilla = await prisma.supply.create({
      data: {
        category_id: syrupCat.id,
        name: 'Vanilla Syrup 750ml',
        base_unit: 'BOTTLE',
        content_per_unit: 750,
        content_unit: 'ML',
      },
    });
    const hazelnut = await prisma.supply.create({
      data: {
        category_id: syrupCat.id,
        name: 'Hazelnut Syrup 750ml',
        base_unit: 'BOTTLE',
        content_per_unit: 750,
        content_unit: 'ML',
      },
    });

    const syrupGroup = await request(app).post('/api/v1/modifier-groups').set(s.auth).send({
      name: 'Syrup Type',
      type: 'SWAP',
      replaces_supply_id: vanilla.id,
      min_selection: 0,
      max_selection: 1,
    });
    expect(syrupGroup.status).toBe(201);
    const hazelnutMod = await request(app)
      .post(`/api/v1/modifier-groups/${syrupGroup.body.data.id}/modifiers`)
      .set(s.auth)
      .send({ name: 'Hazelnut', supply_id: hazelnut.id, ratio: 1, extra_price: 0 });
    expect(hazelnutMod.status).toBe(201);
    await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-groups`)
      .set(s.auth)
      .send({ modifier_group_id: syrupGroup.body.data.id })
      .expect(201);

    await expect(
      deductSaleFromInventory(
        [
          {
            product_id: s.latteProductId,
            variant_id: s.latteLargeId,
            quantity: 1,
            modifier_ids: [hazelnutMod.body.data.id],
          },
        ],
        s.stationId,
        randomUUID(),
      ),
    ).rejects.toThrow(/no top-level line using that supply/);
  });

  it('SWAP does NOT reach into nested preparations — swapping milk on a drink whose recipe only uses milk via a preparation is rejected', async () => {
    // Build a scenario where Whole Milk is consumed only inside a preparation
    // (Steamed Milk 300ml yield), and the top-level drink recipe references
    // the preparation. Ordering that drink with an Almond Milk swap must
    // error because SWAPs only apply at the top of the recipe by design.
    const category = await prisma.productCategory.findFirstOrThrow({ where: { name: 'Hot Coffee' } });

    const steamedMilkProduct = await request(app).post('/api/v1/products').set(s.auth).send({
      name: 'Steamed Milk',
      type: 'PREPARATION',
    });
    expect(steamedMilkProduct.status).toBe(201);
    await request(app)
      .post(`/api/v1/recipes/products/${steamedMilkProduct.body.data.id}`)
      .set(s.auth)
      .send({
        yield_quantity: 300,
        yield_unit: 'ml',
        items: [{ supply_id: s.supplyIds.milk, quantity: 300, unit: 'ml' }],
      })
      .expect(201);

    const cortado = await request(app).post('/api/v1/products').set(s.auth).send({
      name: 'Cortado',
      type: 'DISH',
      category_id: category.id,
      sell_price: 5500,
    });
    const cortadoVar = await request(app)
      .post(`/api/v1/products/${cortado.body.data.id}/variants`)
      .set(s.auth)
      .send({ name: 'Regular', sell_price: 5500 })
      .expect(201);
    await request(app)
      .post(`/api/v1/recipes/variants/${cortadoVar.body.data.id}`)
      .set(s.auth)
      .send({
        items: [
          { preparation_id: steamedMilkProduct.body.data.id, quantity: 150, unit: 'ml' },
          { supply_id: s.supplyIds.espresso, quantity: 18, unit: 'g' },
        ],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/products/${cortado.body.data.id}/modifier-groups`)
      .set(s.auth)
      .send({ modifier_group_id: s.milkSwapGroupId })
      .expect(201);

    await expect(
      deductSaleFromInventory(
        [
          {
            product_id: cortado.body.data.id,
            variant_id: cortadoVar.body.data.id,
            quantity: 1,
            modifier_ids: [s.almondMilkModifierId],
          },
        ],
        s.stationId,
        randomUUID(),
      ),
    ).rejects.toThrow(/no top-level line using that supply/);
  });
});
