import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
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
import { resolveRecipeIngredients } from '../../src/modules/recipes/recipe-resolver.js';

const app = getTestApp();

interface Fixtures {
  auth: Record<string, string>;
  milkSupplyId: string;
  espressoSupplyId: string;
  sugarSupplyId: string;
  cupSupplyId: string;
  simpleSyrupProductId: string;
  latteProductId: string;
  latteVariantId: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const [user, supplier, storage, dairyCat, coffeeCat, sweetenersCat, packagingCat] =
    await Promise.all([
      makeUser(),
      makeSupplier({ name: 'Distribuidora Café del Norte' }),
      makeStorage({ name: 'Bodega' }),
      makeSupplyCategory({ name: 'Dairy' }),
      makeSupplyCategory({ name: 'Coffee' }),
      makeSupplyCategory({ name: 'Sweeteners' }),
      makeSupplyCategory({ name: 'Packaging' }),
    ]);
  const auth = authHeader(user.id, 'ADMIN');

  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk 946ml',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
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
    category_id: sweetenersCat.id,
    name: 'Sugar 1kg',
    base_unit: 'BAG',
    content_per_unit: 1000,
    content_unit: 'G',
  });
  // Piece-type supply (no content_per_unit) — proves the resolver omits
  // content_qty for pieces and the API stays useful for cup waste.
  const cup = await makeSupply({
    category_id: packagingCat.id,
    name: '12oz Cup',
    base_unit: 'PIECE',
  });

  // Pump WAC for each via real purchases — the resolver only needs the
  // structural data, but going through purchases keeps the fixture honest.
  async function buyAt(supplyId: string, pricePerUnit: number): Promise<void> {
    const res = await request(app).post('/api/v1/purchases').set(auth).send({
      supplier_id: supplier.id,
      storage_id: storage.id,
      date: '2026-04-21T00:00:00Z',
      items: [
        {
          supply_id: supplyId,
          packaging_id: null,
          package_quantity: 10,
          price_per_package: pricePerUnit,
        },
      ],
    });
    expect(res.status).toBe(201);
    await request(app)
      .post(`/api/v1/purchases/${res.body.data.id}/confirm`)
      .set(auth)
      .expect(200);
  }
  await buyAt(milk.id, 3000);
  await buyAt(espresso.id, 40000);
  await buyAt(sugar.id, 2000);
  await buyAt(cup.id, 150);

  // Simple Syrup PREPARATION: 100g sugar yields 150ml.
  const prepRes = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Simple Syrup',
    type: 'PREPARATION',
  });
  expect(prepRes.status).toBe(201);
  const simpleSyrupProductId = prepRes.body.data.id as string;

  await request(app)
    .post(`/api/v1/recipes/products/${simpleSyrupProductId}`)
    .set(auth)
    .send({
      yield_quantity: 150,
      yield_unit: 'ml',
      items: [{ supply_id: sugar.id, quantity: 100, unit: 'g' }],
    })
    .expect(201);

  const dishCatRes = await request(app).post('/api/v1/product-categories').set(auth).send({
    name: 'Hot Coffee',
  });
  expect(dishCatRes.status).toBe(201);

  const latteRes = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    category_id: dishCatRes.body.data.id,
    sell_price: 5500,
  });
  expect(latteRes.status).toBe(201);
  const latteProductId = latteRes.body.data.id as string;

  const variantRes = await request(app)
    .post(`/api/v1/products/${latteProductId}/variants`)
    .set(auth)
    .send({ name: 'Medium 12oz', sell_price: 5500 });
  expect(variantRes.status).toBe(201);
  const latteVariantId = variantRes.body.data.id as string;

  // 200ml milk, 18g espresso, 30ml simple-syrup preparation.
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

  return {
    auth,
    milkSupplyId: milk.id,
    espressoSupplyId: espresso.id,
    sugarSupplyId: sugar.id,
    cupSupplyId: cup.id,
    simpleSyrupProductId,
    latteProductId,
    latteVariantId,
  };
}

describe('resolveRecipeIngredients', () => {
  let fixtures: Fixtures;

  beforeEach(async () => {
    fixtures = await setupFixtures();
  });

  it('returns one supply line per raw ingredient, expanding the preparation', async () => {
    const items = await resolveRecipeIngredients(
      fixtures.latteProductId,
      fixtures.latteVariantId,
    );
    // 3 raw supplies: milk, espresso, sugar (from simple syrup preparation).
    expect(items).toHaveLength(3);

    const bySupply = new Map(items.map((i) => [i.supply_id, i]));

    const milk = bySupply.get(fixtures.milkSupplyId);
    expect(milk).toBeDefined();
    expect(milk!.base_unit).toBe('BOTTLE');
    // 200ml / 946ml per bottle = 0.21141649…
    const milkExpected = new Decimal(200).div(946);
    expect(new Decimal(milk!.base_qty).sub(milkExpected).abs().lte('0.0001')).toBe(true);
    // content_qty = base * 946 = 200 ml
    expect(milk!.content_qty).not.toBeNull();
    expect(new Decimal(milk!.content_qty!).sub(200).abs().lte('0.0001')).toBe(true);

    const espresso = bySupply.get(fixtures.espressoSupplyId);
    expect(espresso).toBeDefined();
    // 18g / 1000g per bag = 0.018 bags
    expect(new Decimal(espresso!.base_qty).toString()).toBe('0.018');
    expect(new Decimal(espresso!.content_qty!).toString()).toBe('18');

    const sugar = bySupply.get(fixtures.sugarSupplyId);
    expect(sugar).toBeDefined();
    // Preparation factor: 30ml / 150ml yield = 0.2 servings of simple syrup.
    // Sugar in syrup: 100g per yield → 0.2 * 100g = 20g.
    // 20g / 1000g per bag = 0.02 bags.
    const sugarExpected = new Decimal('0.02');
    expect(new Decimal(sugar!.base_qty).sub(sugarExpected).abs().lte('0.0001')).toBe(true);
    expect(new Decimal(sugar!.content_qty!).sub(20).abs().lte('0.0001')).toBe(true);
  });

  it('sorts results by supply name', async () => {
    const items = await resolveRecipeIngredients(
      fixtures.latteProductId,
      fixtures.latteVariantId,
    );
    const names = items.map((i) => i.supply_name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('throws when the product/variant has no recipe', async () => {
    // The simple syrup PREPARATION product has a recipe; but a fresh product
    // without one should explode.
    const orphanRes = await request(app)
      .post('/api/v1/products')
      .set(fixtures.auth)
      .send({ name: 'Orphan', type: 'DISH' });
    expect(orphanRes.status).toBe(201);
    await expect(
      resolveRecipeIngredients(orphanRes.body.data.id as string, null),
    ).rejects.toThrow(/has no recipe/);
  });

  it('exposes the resolver via GET /api/v1/recipes/ingredients', async () => {
    const res = await request(app)
      .get(`/api/v1/recipes/ingredients?product_id=${fixtures.latteProductId}&variant_id=${fixtures.latteVariantId}`)
      .set(fixtures.auth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    const supplyIds = (res.body.data as Array<{ supply_id: string }>).map(
      (x) => x.supply_id,
    );
    expect(supplyIds).toEqual(
      expect.arrayContaining([
        fixtures.milkSupplyId,
        fixtures.espressoSupplyId,
        fixtures.sugarSupplyId,
      ]),
    );
  });
});
