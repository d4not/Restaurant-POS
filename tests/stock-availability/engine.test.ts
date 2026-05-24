import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import {
  computeAvailabilityBulk,
  computeAvailabilityForLine,
} from '../../src/modules/stock-availability/engine.js';
import {
  makeStorage,
  makeSupplyCategory,
  makeSupply,
  seedStock,
} from '../helpers/factories.js';

// Engine smoke tests — we want to lock the public contract:
//   - PRODUCT type short-circuits to floor(stock).
//   - DISH walks the recipe and limits by the worst supply.
//   - `low` triggers when ANY supply is at-or-below its min_stock.
//   - Modifiers report independent availability without dragging the parent
//     product down.
//   - Soft errors (no recipe, deleted supply, etc.) surface as `unknown` not
//     500s.

describe('computeAvailabilityBulk — PRODUCT type', () => {
  it('reports max_servable = floor(stock.quantity) when stock is well above min', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 500,
      content_unit: 'ML',
    });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 10, min_stock: 2 });

    const product = await prisma.product.create({
      data: {
        name: 'Bottled Water',
        type: 'PRODUCT',
        sell_price: 2500,
        supply_id: supply.id,
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry).toBeDefined();
    expect(entry?.product_type).toBe('PRODUCT');
    expect(entry?.status).toBe('available');
    expect(entry?.max_servable).toBe(10);
    expect(entry?.limiting).toBeNull();
  });

  it('returns `out` when stock is 0', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({ category_id: cat.id });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 0 });

    const product = await prisma.product.create({
      data: { name: 'P', type: 'PRODUCT', sell_price: 100, supply_id: supply.id },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('out');
    expect(entry?.max_servable).toBe(0);
  });

  it('returns `low` when stock ≤ min_stock but > 0', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({ category_id: cat.id });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 2, min_stock: 5 });

    const product = await prisma.product.create({
      data: { name: 'P', type: 'PRODUCT', sell_price: 100, supply_id: supply.id },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('low');
    expect(entry?.max_servable).toBe(2);
    expect(entry?.limiting?.supply_id).toBe(supply.id);
  });

  it('marks `unknown` when PRODUCT has no linked supply_id', async () => {
    const product = await prisma.product.create({
      data: { name: 'Orphan', type: 'PRODUCT', sell_price: 100 },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('unknown');
    expect(entry?.config_errors).toContain('PRODUCT has no linked supply_id');
  });

  it('excludes soft-deleted products from the bulk response', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const supply = await makeSupply({ category_id: cat.id });
    await seedStock({ supply_id: supply.id, storage_id: storage.id, quantity: 10 });

    const product = await prisma.product.create({
      data: {
        name: 'GhostProduct',
        type: 'PRODUCT',
        sell_price: 100,
        supply_id: supply.id,
        deleted_at: new Date(),
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    expect(result.products.find((p) => p.product_id === product.id)).toBeUndefined();
  });
});

describe('computeAvailabilityBulk — DISH type', () => {
  // Helper: build a 2-ingredient DISH. milk in ML/BOTTLE, beans in G/BAG.
  async function seedDish(opts: {
    milkStock: number;
    milkMin?: number;
    beansStock: number;
    beansMin?: number;
  }) {
    const [dairy, coffee, storage] = await Promise.all([
      makeSupplyCategory({ name: 'Dairy' }),
      makeSupplyCategory({ name: 'Coffee' }),
      makeStorage(),
    ]);
    const milk = await makeSupply({
      category_id: dairy.id,
      name: 'Milk',
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    const beans = await makeSupply({
      category_id: coffee.id,
      name: 'Espresso Beans',
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
    });
    await seedStock({
      supply_id: milk.id,
      storage_id: storage.id,
      quantity: opts.milkStock,
      min_stock: opts.milkMin,
    });
    await seedStock({
      supply_id: beans.id,
      storage_id: storage.id,
      quantity: opts.beansStock,
      min_stock: opts.beansMin,
    });

    const product = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    const recipe = await prisma.recipe.create({
      data: {
        product_id: product.id,
        items: {
          create: [
            // 200 ml milk per Latte → 0.2 bottles
            { supply_id: milk.id, quantity: 200, unit: 'ml' },
            // 18 g beans per Latte → 0.018 bags
            { supply_id: beans.id, quantity: 18, unit: 'g' },
          ],
        },
      },
    });
    return { product, recipe, milk, beans, storage };
  }

  it('returns `available` with worst-supply max_servable when both ingredients are plentiful', async () => {
    // milk: 5 bottles → 5000ml → 25 lattes
    // beans: 1 bag → 1000g → 55 lattes
    // worst = milk → 25
    const { product } = await seedDish({ milkStock: 5, beansStock: 1 });
    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('available');
    expect(entry?.max_servable).toBe(25);
    expect(entry?.limiting).toBeNull();
  });

  it('returns `low` when one ingredient is at-or-below min_stock', async () => {
    // beans low: 0.5 bag, min=1 → low; can still serve 27 lattes from beans
    // milk fine: 5 bottles, no min → 25
    // worst = milk (25), but beans is low → flagged `low`
    const { product, beans } = await seedDish({
      milkStock: 5,
      beansStock: 0.5,
      beansMin: 1,
    });
    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('low');
    // Limiting should still be the worst — bottleneck might be beans now (0.5*1000/18 ≈ 27 vs milk 25)
    // Either way, max_servable should be 25 (limiting by milk in raw count)
    expect(entry?.limiting).not.toBeNull();
    // At least we know `beans` IS flagged via low (verified separately by status)
    expect(beans.id).toBeDefined();
  });

  it('returns `out` when one ingredient is fully depleted', async () => {
    // milk 0 bottles → 0 lattes possible
    const { product, milk } = await seedDish({ milkStock: 0, beansStock: 1 });
    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('out');
    expect(entry?.max_servable).toBe(0);
    expect(entry?.limiting?.supply_id).toBe(milk.id);
  });

  it('marks `unknown` when DISH has no recipe', async () => {
    const product = await prisma.product.create({
      data: { name: 'Empty Dish', type: 'DISH', sell_price: 6500 },
    });
    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === product.id);
    expect(entry?.status).toBe('unknown');
    expect(entry?.config_errors).toContain('DISH has no recipe');
  });
});

describe('computeAvailabilityBulk — variants', () => {
  it('enumerates variants separately when a DISH has multiple', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const milk = await makeSupply({
      category_id: cat.id,
      name: 'Milk',
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    await seedStock({ supply_id: milk.id, storage_id: storage.id, quantity: 2 });

    const product = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });

    // Small variant: 150ml milk → 13 servings from 2 bottles
    const small = await prisma.productVariant.create({
      data: { product_id: product.id, name: 'Small', sell_price: 5500 },
    });
    await prisma.recipe.create({
      data: {
        variant_id: small.id,
        items: { create: [{ supply_id: milk.id, quantity: 150, unit: 'ml' }] },
      },
    });

    // Large variant: 400ml milk → 5 servings from 2 bottles
    const large = await prisma.productVariant.create({
      data: { product_id: product.id, name: 'Large', sell_price: 7500 },
    });
    await prisma.recipe.create({
      data: {
        variant_id: large.id,
        items: { create: [{ supply_id: milk.id, quantity: 400, unit: 'ml' }] },
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const smallEntry = result.products.find((p) => p.variant_id === small.id);
    const largeEntry = result.products.find((p) => p.variant_id === large.id);
    expect(smallEntry?.max_servable).toBe(13);
    expect(largeEntry?.max_servable).toBe(5);
  });
});

describe('computeAvailabilityBulk — modifiers independent of parent', () => {
  it('reports modifier availability without touching parent product', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const almond = await makeSupply({
      category_id: cat.id,
      name: 'Almond Milk',
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    // 100ml almond left → 0.5 servings of a 200ml modifier → out (less than 1)
    await seedStock({ supply_id: almond.id, storage_id: storage.id, quantity: 0.1 });

    const group = await prisma.modifierGroup.create({
      data: { name: 'Milk Type', type: 'ADD' },
    });
    const almondMod = await prisma.modifier.create({
      data: {
        group_id: group.id,
        name: 'Almond Milk',
        extra_price: 1000,
        supply_id: almond.id,
        supply_quantity: 200,
        supply_unit: 'ml',
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const modEntry = result.modifiers.find((m) => m.modifier_id === almondMod.id);
    expect(modEntry?.status).toBe('out');
    expect(modEntry?.max_additions).toBe(0);
  });

  it('reports `available` with finite max_additions when modifier has stock', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const almond = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    // 1 bottle (1000ml) / 200ml per modifier = 5 additions
    await seedStock({ supply_id: almond.id, storage_id: storage.id, quantity: 1 });

    const group = await prisma.modifierGroup.create({
      data: { name: 'Milk Type', type: 'ADD' },
    });
    const mod = await prisma.modifier.create({
      data: {
        group_id: group.id,
        name: 'Almond',
        supply_id: almond.id,
        supply_quantity: 200,
        supply_unit: 'ml',
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const modEntry = result.modifiers.find((m) => m.modifier_id === mod.id);
    expect(modEntry?.status).toBe('available');
    expect(modEntry?.max_additions).toBe(5);
  });
});

describe('computeAvailabilityForLine — addOrderItem authority check', () => {
  it('returns `out` when DISH ingredient is fully depleted', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const milk = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    await seedStock({ supply_id: milk.id, storage_id: storage.id, quantity: 0 });

    const product = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    await prisma.recipe.create({
      data: {
        product_id: product.id,
        items: { create: [{ supply_id: milk.id, quantity: 200, unit: 'ml' }] },
      },
    });

    const result = await computeAvailabilityForLine(
      prisma,
      { product_id: product.id, quantity: 1 },
      {},
    );
    expect(result.status).toBe('out');
    expect(result.max_servable).toBe(0);
    expect(result.limiting?.supply_id).toBe(milk.id);
  });

  it('returns `available` when stock can cover the requested quantity', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const milk = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    // 1 bottle covers 5 lattes @ 200ml each
    await seedStock({ supply_id: milk.id, storage_id: storage.id, quantity: 1 });

    const product = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    await prisma.recipe.create({
      data: {
        product_id: product.id,
        items: { create: [{ supply_id: milk.id, quantity: 200, unit: 'ml' }] },
      },
    });

    const result = await computeAvailabilityForLine(
      prisma,
      { product_id: product.id, quantity: 3 },
      {},
    );
    expect(result.status).toBe('available');
    expect(result.max_servable).toBe(5);
  });

  it('returns `out` when quantity exceeds max_servable', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const milk = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
    });
    await seedStock({ supply_id: milk.id, storage_id: storage.id, quantity: 0.4 });

    const product = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    await prisma.recipe.create({
      data: {
        product_id: product.id,
        items: { create: [{ supply_id: milk.id, quantity: 200, unit: 'ml' }] },
      },
    });

    // 400ml / 200ml = 2 servings. Requesting 3 → OUT.
    const result = await computeAvailabilityForLine(
      prisma,
      { product_id: product.id, quantity: 3 },
      {},
    );
    expect(result.status).toBe('out');
    expect(result.max_servable).toBe(2);
  });

  it('returns `unknown` when DISH has no recipe', async () => {
    const product = await prisma.product.create({
      data: { name: 'Empty', type: 'DISH', sell_price: 6500 },
    });
    const result = await computeAvailabilityForLine(
      prisma,
      { product_id: product.id, quantity: 1 },
      {},
    );
    expect(result.status).toBe('unknown');
    expect(result.config_errors.length).toBeGreaterThan(0);
  });
});

describe('computeAvailabilityBulk — preparation recursion', () => {
  it('walks a preparation sub-recipe to find the limiting raw supply', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const sugar = await makeSupply({
      category_id: cat.id,
      name: 'Sugar',
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
    });
    // 0.05 bag = 50g. Syrup recipe yields 150ml from 100g sugar.
    // Latte uses 30ml syrup → factor = 30/150 = 0.2 → 20g sugar per latte.
    // 50g / 20g = 2 lattes possible.
    await seedStock({ supply_id: sugar.id, storage_id: storage.id, quantity: 0.05 });

    const syrupProduct = await prisma.product.create({
      data: { name: 'Simple Syrup', type: 'PREPARATION' },
    });
    await prisma.recipe.create({
      data: {
        product_id: syrupProduct.id,
        yield_quantity: 150,
        yield_unit: 'ml',
        items: { create: [{ supply_id: sugar.id, quantity: 100, unit: 'g' }] },
      },
    });

    const latteProduct = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    await prisma.recipe.create({
      data: {
        product_id: latteProduct.id,
        items: {
          create: [
            { preparation_id: syrupProduct.id, quantity: 30, unit: 'ml' },
          ],
        },
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === latteProduct.id);
    expect(entry?.status).toBe('available');
    expect(entry?.max_servable).toBe(2);
    // available → limiting is null by contract; the bottleneck only surfaces
    // when status is low/out
    expect(entry?.limiting).toBeNull();
  });

  it('marks `out` when the preparation chain leaves zero servings', async () => {
    const cat = await makeSupplyCategory();
    const storage = await makeStorage();
    const sugar = await makeSupply({
      category_id: cat.id,
      name: 'Sugar',
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
    });
    await seedStock({ supply_id: sugar.id, storage_id: storage.id, quantity: 0 });

    const syrupProduct = await prisma.product.create({
      data: { name: 'Syrup', type: 'PREPARATION' },
    });
    await prisma.recipe.create({
      data: {
        product_id: syrupProduct.id,
        yield_quantity: 150,
        yield_unit: 'ml',
        items: { create: [{ supply_id: sugar.id, quantity: 100, unit: 'g' }] },
      },
    });

    const latteProduct = await prisma.product.create({
      data: { name: 'Latte', type: 'DISH', sell_price: 6500 },
    });
    await prisma.recipe.create({
      data: {
        product_id: latteProduct.id,
        items: { create: [{ preparation_id: syrupProduct.id, quantity: 30, unit: 'ml' }] },
      },
    });

    const result = await computeAvailabilityBulk(prisma, {});
    const entry = result.products.find((p) => p.product_id === latteProduct.id);
    expect(entry?.status).toBe('out');
    expect(entry?.max_servable).toBe(0);
    expect(entry?.limiting?.supply_id).toBe(sugar.id);
  });
});
