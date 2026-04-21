import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { Decimal } from '../../src/lib/decimal.js';
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

// End-to-end recipe cost test using the scenario called out in the task:
//   200ml whole milk  (946ml bottle @ $30)   → 634.2494... centavos
//   18g  espresso     (1kg bag @ $400)       → 720 centavos
//   30ml simple syrup (preparation)          →  40 centavos
//
// Total ≈ 1394.2495 centavos.
//
// The setup deliberately runs through the public API (purchase confirm for
// WAC, recipe creation) instead of seeding values directly, so this also
// proves the auto-recalc hooks wire up end-to-end.

interface Fixtures {
  userId: string;
  supplierId: string;
  storageId: string;
  milkSupplyId: string;
  espressoSupplyId: string;
  sugarSupplyId: string;
  simpleSyrupProductId: string;
  simpleSyrupRecipeId: string;
  latteProductId: string;
  latteVariantId: string;
  latteRecipeId: string;
  auth: Record<string, string>;
}

async function setupCafeWithStock(): Promise<{
  userId: string;
  supplierId: string;
  storageId: string;
  milkSupplyId: string;
  espressoSupplyId: string;
  sugarSupplyId: string;
  auth: Record<string, string>;
}> {
  const [user, supplier, storage, dairyCat, coffeeCat, sweetenersCat] = await Promise.all([
    makeUser(),
    makeSupplier({ name: 'Distribuidora Café del Norte' }),
    makeStorage({ name: 'Bodega' }),
    makeSupplyCategory({ name: 'Dairy' }),
    makeSupplyCategory({ name: 'Coffee' }),
    makeSupplyCategory({ name: 'Sweeteners' }),
  ]);

  const auth = authHeader(user.id, 'ADMIN');

  // Whole milk: 946ml bottle
  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });

  // Espresso beans: 1kg bag
  const espresso = await makeSupply({
    category_id: coffeeCat.id,
    name: 'Espresso Beans 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });

  // Sugar: 1kg bag (for simple syrup preparation)
  const sugar = await makeSupply({
    category_id: sweetenersCat.id,
    name: 'Sugar 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });

  // Purchase each supply at the prices in the scenario. Going through the
  // real purchase-confirm path ensures Supply.average_cost is populated by
  // the same code that runs in production.
  async function buyAt(supplyId: string, pricePerUnit: number): Promise<void> {
    const createRes = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        supplier_id: supplier.id,
        storage_id: storage.id,
        date: '2026-04-21T00:00:00Z',
        items: [
          {
            supply_id: supplyId,
            packaging_id: null,
            package_quantity: 10, // ten units — big enough that a few deductions never underflow
            price_per_package: pricePerUnit,
          },
        ],
      });
    expect(createRes.status).toBe(201);
    await request(app)
      .post(`/api/v1/purchases/${createRes.body.data.id}/confirm`)
      .set(auth)
      .expect(200);
  }

  await buyAt(milk.id, 3000);     // $30 per bottle
  await buyAt(espresso.id, 40000); // $400 per bag
  await buyAt(sugar.id, 2000);     // $20 per bag

  return {
    userId: user.id,
    supplierId: supplier.id,
    storageId: storage.id,
    milkSupplyId: milk.id,
    espressoSupplyId: espresso.id,
    sugarSupplyId: sugar.id,
    auth,
  };
}

async function setupFixtures(): Promise<Fixtures> {
  const base = await setupCafeWithStock();

  // Simple Syrup PREPARATION: 100g sugar yields 150ml
  const prepRes = await request(app).post('/api/v1/products').set(base.auth).send({
    name: 'Simple Syrup',
    type: 'PREPARATION',
  });
  expect(prepRes.status).toBe(201);
  const simpleSyrupProductId = prepRes.body.data.id as string;

  const prepRecipeRes = await request(app)
    .post(`/api/v1/recipes/products/${simpleSyrupProductId}`)
    .set(base.auth)
    .send({
      yield_quantity: 150,
      yield_unit: 'ml',
      items: [{ supply_id: base.sugarSupplyId, quantity: 100, unit: 'g' }],
    });
  expect(prepRecipeRes.status).toBe(201);
  const simpleSyrupRecipeId = prepRecipeRes.body.data.id as string;

  // Latte DISH with a "Medium" variant
  const dishCatRes = await request(app).post('/api/v1/product-categories').set(base.auth).send({
    name: 'Hot Coffee',
  });
  expect(dishCatRes.status).toBe(201);

  const latteRes = await request(app).post('/api/v1/products').set(base.auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: dishCatRes.body.data.id,
    sell_price: 5500, // $55.00 — used for food_cost_pct and markup
  });
  expect(latteRes.status).toBe(201);
  const latteProductId = latteRes.body.data.id as string;

  const variantRes = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(base.auth)
    .send({ name: 'Medium 12oz', sell_price: 5500 });
  expect(variantRes.status).toBe(201);
  const latteVariantId = variantRes.body.data.id as string;

  // Build the Latte recipe on the variant.
  const recipeRes = await request(app)
    .post(`/api/v1/recipes/variants/${latteVariantId}`)
    .set(base.auth)
    .send({
      items: [
        { supply_id: base.milkSupplyId, quantity: 200, unit: 'ml' },
        { supply_id: base.espressoSupplyId, quantity: 18, unit: 'g' },
        { preparation_id: simpleSyrupProductId, quantity: 30, unit: 'ml' },
      ],
    });
  expect(recipeRes.status).toBe(201);
  const latteRecipeId = recipeRes.body.data.id as string;

  return {
    ...base,
    simpleSyrupProductId,
    simpleSyrupRecipeId,
    latteProductId,
    latteVariantId,
    latteRecipeId,
  };
}

describe('Latte recipe cost — full API wiring', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('computes simple syrup preparation cost: 100g sugar (WAC 2000/bag of 1000g) = 200 centavos', async () => {
    const prep = await prisma.product.findUniqueOrThrow({
      where: { id: fixtures.simpleSyrupProductId },
    });
    // 100g / 1000g per bag * 2000 centavos = 200
    expect(new Decimal(prep.recipe_cost).toString()).toBe('200');
  });

  it('computes each Latte line cost correctly', async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });

    // Exact expected:
    //   milk     = 200 * 3000 / 946         = 600000 / 946
    //   espresso = 18  * 40000 / 1000       = 720
    //   syrup    = (30 / 150) * 200         = 40
    const milk = new Decimal(600000).div(946);
    const espresso = new Decimal(720);
    const syrup = new Decimal(40);
    const expected = milk.add(espresso).add(syrup);

    // Prisma stores NUMERIC(14,4), so the persisted value is rounded/truncated
    // to 4 decimal places. Compare within 0.0001 tolerance.
    const actual = new Decimal(variant.recipe_cost);
    const diff = actual.sub(expected).abs();
    expect(diff.lte(new Decimal('0.0001'))).toBe(true);
  });

  it('computes food_cost_pct on the variant from sell_price', async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });
    // expected_pct = recipe_cost / 5500 * 100
    const cost = new Decimal(variant.recipe_cost);
    const expectedPct = cost.div(5500).mul(100);
    const actualPct = new Decimal(variant.food_cost_pct);
    const diff = actualPct.sub(expectedPct).abs();
    expect(diff.lte(new Decimal('0.01'))).toBe(true);
  });

  it('recalculates when a recipe item is added', async () => {
    // Adding 10g cocoa powder at a 1kg bag / $500 supply bumps the cost.
    const cocoaCat = await prisma.supplyCategory.create({ data: { name: 'Toppings' } });
    const cocoa = await makeSupply({
      category_id: cocoaCat.id,
      name: 'Cocoa Powder 1kg',
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
    });
    // Buy cocoa so it has a WAC.
    const buyRes = await request(app).post('/api/v1/purchases').set(fixtures.auth).send({
      supplier_id: fixtures.supplierId,
      storage_id: fixtures.storageId,
      date: '2026-04-21T00:00:00Z',
      items: [
        {
          supply_id: cocoa.id,
          packaging_id: null,
          package_quantity: 1,
          price_per_package: 50000,
        },
      ],
    });
    expect(buyRes.status).toBe(201);
    await request(app)
      .post(`/api/v1/purchases/${buyRes.body.data.id}/confirm`)
      .set(fixtures.auth)
      .expect(200);

    const before = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });

    const addRes = await request(app)
      .post(`/api/v1/recipes/${fixtures.latteRecipeId}/items`)
      .set(fixtures.auth)
      .send({ supply_id: cocoa.id, quantity: 10, unit: 'g' });
    expect(addRes.status).toBe(201);

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });

    // 10g cocoa * 50000/1000 = 500 centavos added to recipe_cost.
    const delta = new Decimal(after.recipe_cost).sub(new Decimal(before.recipe_cost));
    const diff = delta.sub(new Decimal(500)).abs();
    expect(diff.lte(new Decimal('0.0001'))).toBe(true);
  });

  it('recalculates when a preparation recipe changes (cascade)', async () => {
    // Bump the simple syrup yield from 150ml to 300ml: each 30ml now costs half.
    const prep = await prisma.recipe.findUniqueOrThrow({
      where: { product_id: fixtures.simpleSyrupProductId },
    });

    const before = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });

    const patchRes = await request(app)
      .patch(`/api/v1/recipes/${prep.id}`)
      .set(fixtures.auth)
      .send({ yield_quantity: 300 });
    expect(patchRes.status).toBe(200);

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });

    // Syrup line drops from 40 → 20, so total recipe_cost drops by 20.
    const delta = new Decimal(before.recipe_cost).sub(new Decimal(after.recipe_cost));
    const diff = delta.sub(new Decimal(20)).abs();
    expect(diff.lte(new Decimal('0.0001'))).toBe(true);
  });

  it('on-demand recalculate endpoint returns current cost', async () => {
    const res = await request(app)
      .post(`/api/v1/recipes/${fixtures.latteRecipeId}/recalculate`)
      .set(fixtures.auth);
    expect(res.status).toBe(200);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixtures.latteVariantId },
    });
    const reported = new Decimal(res.body.data.recipe_cost);
    const stored = new Decimal(variant.recipe_cost);
    const diff = reported.sub(stored).abs();
    expect(diff.lte(new Decimal('0.0001'))).toBe(true);
  });
});

describe('Recipe validation guards', () => {
  it('rejects a recipe on a PRODUCT (packaged item)', async () => {
    const { auth } = await setupCafeWithStock();
    const product = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Bottled Water',
      type: 'PRODUCT',
      sell_price: 2500,
    });
    expect(product.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/recipes/products/${product.body.data.id}`)
      .set(auth)
      .send({ items: [] });
    expect(res.status).toBe(400);
  });

  it('requires yield fields for PREPARATION recipes', async () => {
    const { auth } = await setupCafeWithStock();
    const prep = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Chocolate Sauce',
      type: 'PREPARATION',
    });
    expect(prep.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/recipes/products/${prep.body.data.id}`)
      .set(auth)
      .send({ items: [] }); // no yield fields
    expect(res.status).toBe(400);
  });

  it('rejects a recipe item with both supply_id and preparation_id', async () => {
    const base = await setupCafeWithStock();

    const dish = await request(app).post('/api/v1/products').set(base.auth).send({
      name: 'Test Dish',
      type: 'DISH',
      sell_price: 1000,
    });
    expect(dish.status).toBe(201);

    const recipeRes = await request(app)
      .post(`/api/v1/recipes/products/${dish.body.data.id}`)
      .set(base.auth)
      .send({});
    expect(recipeRes.status).toBe(201);

    const badItem = await request(app)
      .post(`/api/v1/recipes/${recipeRes.body.data.id}/items`)
      .set(base.auth)
      .send({
        supply_id: base.milkSupplyId,
        preparation_id: base.milkSupplyId, // also set — should fail
        quantity: 10,
        unit: 'ml',
      });
    expect(badItem.status).toBe(422);
  });
});
