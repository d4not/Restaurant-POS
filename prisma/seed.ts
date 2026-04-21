/**
 * Café seed — populates the full scenario described in SPEC.md §"Seed data for
 * testing". Designed to be re-runnable: truncates the operational tables first,
 * then creates supplies, suppliers, storages, products, recipes, preparations,
 * modifiers, purchases (which exercise WAC + stock upsert), and a handful of
 * sample sales (which exercise recipe deduction and SALE stock movements).
 *
 * Run with: `npx prisma db seed` (wired via package.json#prisma.seed).
 */
import { randomUUID } from 'node:crypto';
import { Prisma, ProductType } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { confirmPurchase } from '../src/modules/purchases/service.js';
import {
  createProductRecipe,
  createVariantRecipe,
} from '../src/modules/recipes/service.js';
import { deductSaleFromInventory } from '../src/modules/sales/service.js';
import { hashPassword } from '../src/modules/auth/service.js';

// Tables wiped at the start — mirrors tests/setup.ts so re-seeding doesn't
// leave stale rows from a previous run behind.
const TRUNCATE_TABLES = [
  'stock_movements',
  'inventory_check_items',
  'inventory_checks',
  'write_offs',
  'transfer_items',
  'transfers',
  'purchase_items',
  'purchases',
  'storage_stocks',
  'tare_weights',
  'product_modifications',
  'recipe_items',
  'recipes',
  'product_modifier_groups',
  'modifiers',
  'modifier_groups',
  'product_variants',
  'products',
  'product_categories',
  'purchase_packagings',
  'supplies',
  'supply_categories',
  'suppliers',
  'deduction_rules',
  'storages',
  'taxes',
  'payroll_periods',
  'attendance',
  'users',
];

async function truncate(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );
}

async function main(): Promise<void> {
  await truncate();

  // --------------------------------------------------------------------------
  // People and infrastructure
  // --------------------------------------------------------------------------
  const admin = await prisma.user.create({
    data: {
      name: 'Café Admin',
      email: 'admin@pos.local',
      pin: '1234',
      // Dev-only credentials — admin@pos.local / admin123. Rotate in prod.
      password_hash: await hashPassword('admin123'),
      role: 'ADMIN',
    },
  });

  const supplier = await prisma.supplier.create({
    data: {
      name: 'Distribuidora Café del Norte',
      contact_name: 'María García',
      phone: '+52 81 1234 5678',
      email: 'ventas@cafenorte.mx',
      credit_days: 30,
    },
  });

  const [bodega, barra] = await Promise.all([
    prisma.storage.create({ data: { name: 'Bodega', address: 'Almacén trasero' } }),
    prisma.storage.create({ data: { name: 'Barra', address: 'Estación de bar' } }),
  ]);

  // A default deduction rule: anything sold lands against Barra. Tests and the
  // deduction engine treat the null/null row as the fallback.
  await prisma.deductionRule.create({
    data: { station_id: null, pos_register_id: null, storage_id: barra.id },
  });

  const tax = await prisma.tax.create({ data: { name: 'IVA 16%', rate: 16 } });

  // --------------------------------------------------------------------------
  // Supply categories + supplies
  // --------------------------------------------------------------------------
  const [dairyCat, coffeeCat, syrupCat, sauceCat, sweetCat, disposableCat, bottledCat] =
    await Promise.all([
      prisma.supplyCategory.create({ data: { name: 'Dairy' } }),
      prisma.supplyCategory.create({ data: { name: 'Coffee' } }),
      prisma.supplyCategory.create({ data: { name: 'Syrups' } }),
      prisma.supplyCategory.create({ data: { name: 'Sauces' } }),
      prisma.supplyCategory.create({ data: { name: 'Sweeteners' } }),
      prisma.supplyCategory.create({ data: { name: 'Disposables' } }),
      prisma.supplyCategory.create({ data: { name: 'Bottled Drinks' } }),
    ]);

  const milk = await prisma.supply.create({
    data: {
      name: 'Whole Milk 946ml',
      category_id: dairyCat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 946,
      content_unit: 'ML',
      barcode: '7501234500001',
    },
  });
  const almond = await prisma.supply.create({
    data: {
      name: 'Almond Milk 1L',
      category_id: dairyCat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'ML',
      barcode: '7501234500002',
    },
  });
  const espresso = await prisma.supply.create({
    data: {
      name: 'Espresso Beans 1kg',
      category_id: coffeeCat.id,
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
      barcode: '7501234500003',
    },
  });
  const vanillaSyrup = await prisma.supply.create({
    data: {
      name: 'Vanilla Syrup 750ml',
      category_id: syrupCat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 750,
      content_unit: 'ML',
      barcode: '7501234500004',
    },
  });
  const chocolateSauce = await prisma.supply.create({
    data: {
      name: 'Chocolate Sauce 1kg',
      category_id: sauceCat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 1000,
      content_unit: 'G',
      barcode: '7501234500005',
    },
  });
  const sugar = await prisma.supply.create({
    data: {
      name: 'Sugar 1kg',
      category_id: sweetCat.id,
      base_unit: 'BAG',
      content_per_unit: 1000,
      content_unit: 'G',
      barcode: '7501234500006',
    },
  });
  const cup8 = await prisma.supply.create({
    data: { name: 'Cup 8oz', category_id: disposableCat.id, base_unit: 'PIECE' },
  });
  const cup12 = await prisma.supply.create({
    data: { name: 'Cup 12oz', category_id: disposableCat.id, base_unit: 'PIECE' },
  });
  const cup16 = await prisma.supply.create({
    data: { name: 'Cup 16oz', category_id: disposableCat.id, base_unit: 'PIECE' },
  });
  const water = await prisma.supply.create({
    data: {
      name: 'Bottled Water 500ml',
      category_id: bottledCat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 500,
      content_unit: 'ML',
      barcode: '7501234500007',
    },
  });

  // Low-stock alerts need a min_stock threshold. Configure a few so the alert
  // endpoint has data to surface.
  const seedStocks: Array<{
    supply_id: string;
    storage_id: string;
    min_stock: number;
  }> = [
    { supply_id: milk.id, storage_id: barra.id, min_stock: 3 },
    { supply_id: almond.id, storage_id: barra.id, min_stock: 2 },
    { supply_id: espresso.id, storage_id: barra.id, min_stock: 1 },
    { supply_id: cup8.id, storage_id: barra.id, min_stock: 50 },
    { supply_id: cup12.id, storage_id: barra.id, min_stock: 50 },
    // 16oz cups land at 78 after sales — min 80 intentionally triggers a low-stock alert
    { supply_id: cup16.id, storage_id: barra.id, min_stock: 80 },
    { supply_id: water.id, storage_id: barra.id, min_stock: 20 },
    { supply_id: milk.id, storage_id: bodega.id, min_stock: 10 },
    { supply_id: espresso.id, storage_id: bodega.id, min_stock: 3 },
    { supply_id: sugar.id, storage_id: bodega.id, min_stock: 2 },
  ];
  for (const row of seedStocks) {
    await prisma.storageStock.upsert({
      where: {
        supply_id_storage_id: {
          supply_id: row.supply_id,
          storage_id: row.storage_id,
        },
      },
      create: {
        supply_id: row.supply_id,
        storage_id: row.storage_id,
        quantity: 0,
        min_stock: row.min_stock,
      },
      update: { min_stock: row.min_stock },
    });
  }

  // --------------------------------------------------------------------------
  // Purchase packagings (optional — illustrative of the 3-layer unit model)
  // --------------------------------------------------------------------------
  const milkCase = await prisma.purchasePackaging.create({
    data: {
      supply_id: milk.id,
      supplier_id: supplier.id,
      name: 'Case of 6 bottles',
      units_per_package: 6,
    },
  });
  const cupSleeve = await prisma.purchasePackaging.create({
    data: {
      supply_id: cup12.id,
      supplier_id: supplier.id,
      name: 'Sleeve of 50',
      units_per_package: 50,
    },
  });

  // --------------------------------------------------------------------------
  // Purchases — confirm so WAC + StorageStock + StockMovements all populate.
  //
  // Unit prices below are per-package; the purchase confirm path divides them
  // down to per-base-unit cost. Values chosen to produce realistic centavo WACs.
  // --------------------------------------------------------------------------
  async function buyAndConfirm(
    storageId: string,
    items: Array<{
      supply_id: string;
      packaging_id?: string | null;
      package_quantity: number;
      price_per_package: number;
    }>,
    dateIso: string,
  ): Promise<void> {
    const purchase = await prisma.purchase.create({
      data: {
        supplier_id: supplier.id,
        storage_id: storageId,
        date: new Date(dateIso),
        status: 'DRAFT',
        user_id: admin.id,
        items: {
          create: items.map((i) => ({
            supply_id: i.supply_id,
            packaging_id: i.packaging_id ?? null,
            package_quantity: i.package_quantity,
            price_per_package: i.price_per_package,
            base_unit_quantity: 0,
            unit_cost: 0,
          })),
        },
      },
    });
    await confirmPurchase(purchase.id);
  }

  // Initial Bodega load — bulk buys into the warehouse.
  await buyAndConfirm(
    bodega.id,
    [
      // 4 cases × 6 bottles × 3500c per bottle → 24 bottles of whole milk
      { supply_id: milk.id, packaging_id: milkCase.id, package_quantity: 4, price_per_package: 21000 },
      // 12 bottles of almond milk @ 5500c
      { supply_id: almond.id, package_quantity: 12, price_per_package: 5500 },
      // 10 bags of espresso beans @ 42000c / kg
      { supply_id: espresso.id, package_quantity: 10, price_per_package: 42000 },
      // 6 bottles of vanilla syrup @ 18000c / bottle
      { supply_id: vanillaSyrup.id, package_quantity: 6, price_per_package: 18000 },
      // 4 bottles of chocolate sauce @ 22000c / bottle
      { supply_id: chocolateSauce.id, package_quantity: 4, price_per_package: 22000 },
      // 15 bags of sugar @ 2500c / kg
      { supply_id: sugar.id, package_quantity: 15, price_per_package: 2500 },
      // Disposables: 400 cups via sleeves (8 sleeves × 50)
      { supply_id: cup12.id, packaging_id: cupSleeve.id, package_quantity: 8, price_per_package: 17500 },
      // 300 pieces of 8oz cups bought individually (wholesale)
      { supply_id: cup8.id, package_quantity: 300, price_per_package: 300 },
      // 200 pieces of 16oz cups
      { supply_id: cup16.id, package_quantity: 200, price_per_package: 450 },
      // 48 bottles of water @ 1200c
      { supply_id: water.id, package_quantity: 48, price_per_package: 1200 },
    ],
    '2026-04-10T09:00:00Z',
  );

  // Restock directly to Barra so the bar has front-of-house inventory.
  await buyAndConfirm(
    barra.id,
    [
      { supply_id: milk.id, package_quantity: 6, price_per_package: 3600 },
      { supply_id: almond.id, package_quantity: 4, price_per_package: 5700 },
      { supply_id: espresso.id, package_quantity: 2, price_per_package: 43000 },
      { supply_id: vanillaSyrup.id, package_quantity: 2, price_per_package: 18500 },
      { supply_id: chocolateSauce.id, package_quantity: 1, price_per_package: 22500 },
      { supply_id: sugar.id, package_quantity: 3, price_per_package: 2600 },
      { supply_id: cup8.id, package_quantity: 100, price_per_package: 310 },
      { supply_id: cup12.id, package_quantity: 100, price_per_package: 360 },
      { supply_id: cup16.id, package_quantity: 80, price_per_package: 460 },
      { supply_id: water.id, package_quantity: 24, price_per_package: 1250 },
    ],
    '2026-04-18T09:00:00Z',
  );

  // --------------------------------------------------------------------------
  // Product catalog
  // --------------------------------------------------------------------------
  const [hotCoffeeCat, coldCoffeeCat, bottledDrinksCat] = await Promise.all([
    prisma.productCategory.create({
      data: { name: 'Hot Coffee', display_order: 1, color: '#6b3f1d' },
    }),
    prisma.productCategory.create({
      data: { name: 'Cold Coffee', display_order: 2, color: '#4a90e2' },
    }),
    prisma.productCategory.create({
      data: { name: 'Bottled Drinks', display_order: 3, color: '#50c878' },
    }),
  ]);

  // --- Preparations ---------------------------------------------------------
  const simpleSyrup = await prisma.product.create({
    data: { name: 'Simple Syrup', type: ProductType.PREPARATION },
  });
  await createProductRecipe(simpleSyrup.id, {
    yield_quantity: 150,
    yield_unit: 'ml',
    items: [{ supply_id: sugar.id, quantity: 100, unit: 'g', waste_pct: 0 }],
  });

  const mochaSauce = await prisma.product.create({
    data: { name: 'Mocha Sauce', type: ProductType.PREPARATION },
  });
  await createProductRecipe(mochaSauce.id, {
    yield_quantity: 300,
    yield_unit: 'ml',
    items: [
      { supply_id: chocolateSauce.id, quantity: 150, unit: 'g', waste_pct: 0 },
      { supply_id: sugar.id, quantity: 50, unit: 'g', waste_pct: 0 },
    ],
  });

  // --- Helper to build a DISH with N variants and a recipe per variant -----
  async function createDish(params: {
    name: string;
    category_id: string;
    variants: Array<{
      name: string;
      sell_price: number;
      items: Array<{
        supply_id?: string;
        preparation_id?: string;
        quantity: number;
        unit: string;
        waste_pct?: number;
      }>;
    }>;
  }): Promise<void> {
    const product = await prisma.product.create({
      data: {
        name: params.name,
        type: ProductType.DISH,
        category_id: params.category_id,
        tax_id: tax.id,
      },
    });
    for (const [idx, v] of params.variants.entries()) {
      const variant = await prisma.productVariant.create({
        data: {
          product_id: product.id,
          name: v.name,
          sell_price: v.sell_price,
          display_order: idx,
        },
      });
      await createVariantRecipe(variant.id, { items: v.items });
    }
  }

  // --- Latte (3 variants) ---------------------------------------------------
  await createDish({
    name: 'Latte',
    category_id: hotCoffeeCat.id,
    variants: [
      {
        name: 'Small 8oz',
        sell_price: 5500,
        items: [
          { supply_id: milk.id, quantity: 150, unit: 'ml' },
          { supply_id: espresso.id, quantity: 14, unit: 'g' },
          { supply_id: cup8.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Medium 12oz',
        sell_price: 6500,
        items: [
          { supply_id: milk.id, quantity: 200, unit: 'ml' },
          { supply_id: espresso.id, quantity: 18, unit: 'g' },
          { supply_id: cup12.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Large 16oz',
        sell_price: 7500,
        items: [
          { supply_id: milk.id, quantity: 280, unit: 'ml' },
          { supply_id: espresso.id, quantity: 22, unit: 'g' },
          { supply_id: cup16.id, quantity: 1, unit: 'piece' },
        ],
      },
    ],
  });

  // --- Cappuccino (3 variants) ---------------------------------------------
  await createDish({
    name: 'Cappuccino',
    category_id: hotCoffeeCat.id,
    variants: [
      {
        name: 'Small 8oz',
        sell_price: 5500,
        items: [
          { supply_id: milk.id, quantity: 100, unit: 'ml' },
          { supply_id: espresso.id, quantity: 14, unit: 'g' },
          { supply_id: cup8.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Medium 12oz',
        sell_price: 6500,
        items: [
          { supply_id: milk.id, quantity: 150, unit: 'ml' },
          { supply_id: espresso.id, quantity: 18, unit: 'g' },
          { supply_id: cup12.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Large 16oz',
        sell_price: 7500,
        items: [
          { supply_id: milk.id, quantity: 220, unit: 'ml' },
          { supply_id: espresso.id, quantity: 22, unit: 'g' },
          { supply_id: cup16.id, quantity: 1, unit: 'piece' },
        ],
      },
    ],
  });

  // --- Americano (2 variants) ----------------------------------------------
  await createDish({
    name: 'Americano',
    category_id: hotCoffeeCat.id,
    variants: [
      {
        name: 'Medium 12oz',
        sell_price: 4500,
        items: [
          { supply_id: espresso.id, quantity: 14, unit: 'g' },
          { supply_id: cup12.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Large 16oz',
        sell_price: 5500,
        items: [
          { supply_id: espresso.id, quantity: 18, unit: 'g' },
          { supply_id: cup16.id, quantity: 1, unit: 'piece' },
        ],
      },
    ],
  });

  // --- Mocha (3 variants) - uses the mocha sauce preparation ---------------
  await createDish({
    name: 'Mocha',
    category_id: hotCoffeeCat.id,
    variants: [
      {
        name: 'Small 8oz',
        sell_price: 6500,
        items: [
          { supply_id: milk.id, quantity: 130, unit: 'ml' },
          { supply_id: espresso.id, quantity: 14, unit: 'g' },
          { preparation_id: mochaSauce.id, quantity: 30, unit: 'ml' },
          { supply_id: cup8.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Medium 12oz',
        sell_price: 7500,
        items: [
          { supply_id: milk.id, quantity: 170, unit: 'ml' },
          { supply_id: espresso.id, quantity: 18, unit: 'g' },
          { preparation_id: mochaSauce.id, quantity: 40, unit: 'ml' },
          { supply_id: cup12.id, quantity: 1, unit: 'piece' },
        ],
      },
      {
        name: 'Large 16oz',
        sell_price: 8500,
        items: [
          { supply_id: milk.id, quantity: 240, unit: 'ml' },
          { supply_id: espresso.id, quantity: 22, unit: 'g' },
          { preparation_id: mochaSauce.id, quantity: 50, unit: 'ml' },
          { supply_id: cup16.id, quantity: 1, unit: 'piece' },
        ],
      },
    ],
  });

  // --- Bottled Water (packaged PRODUCT, deducts 1 supply unit per sale) ----
  await prisma.product.create({
    data: {
      name: 'Bottled Water',
      type: ProductType.PRODUCT,
      category_id: bottledDrinksCat.id,
      sell_price: 2500,
      supply_id: water.id,
      tax_id: tax.id,
    },
  });

  // --------------------------------------------------------------------------
  // Modifier groups — Milk Type, Extras, Sweetener.
  //
  // Attached to Latte, Cappuccino, and Mocha (dishes where the customer
  // typically customizes). Americano only gets Extras.
  // --------------------------------------------------------------------------
  const milkGroup = await prisma.modifierGroup.create({
    data: { name: 'Milk Type', min_selection: 0, max_selection: 1, display_order: 1 },
  });
  await prisma.modifier.create({
    data: {
      group_id: milkGroup.id,
      name: 'Whole Milk',
      extra_price: 0,
      display_order: 0,
    },
  });
  await prisma.modifier.create({
    data: {
      group_id: milkGroup.id,
      name: 'Almond Milk',
      extra_price: 1000,
      supply_id: almond.id,
      supply_quantity: 200,
      supply_unit: 'ml',
      display_order: 1,
    },
  });

  const extrasGroup = await prisma.modifierGroup.create({
    data: { name: 'Extras', min_selection: 0, max_selection: 3, display_order: 2 },
  });
  await prisma.modifier.create({
    data: {
      group_id: extrasGroup.id,
      name: 'Extra Shot',
      extra_price: 1500,
      supply_id: espresso.id,
      supply_quantity: 9,
      supply_unit: 'g',
      display_order: 0,
    },
  });
  await prisma.modifier.create({
    data: {
      group_id: extrasGroup.id,
      name: 'Vanilla Syrup',
      extra_price: 800,
      supply_id: vanillaSyrup.id,
      supply_quantity: 15,
      supply_unit: 'ml',
      display_order: 1,
    },
  });
  await prisma.modifier.create({
    data: {
      group_id: extrasGroup.id,
      name: 'Decaf',
      extra_price: 0,
      display_order: 2,
    },
  });

  const sweetenerGroup = await prisma.modifierGroup.create({
    data: { name: 'Sweetener', min_selection: 0, max_selection: 1, display_order: 3 },
  });
  const sugarModifier = await prisma.modifier.create({
    data: {
      group_id: sweetenerGroup.id,
      name: 'Sugar',
      extra_price: 0,
      supply_id: sugar.id,
      supply_quantity: 5,
      supply_unit: 'g',
      display_order: 0,
    },
  });
  await prisma.modifier.create({
    data: {
      group_id: sweetenerGroup.id,
      name: 'Stevia',
      extra_price: 0,
      display_order: 1,
    },
  });

  const latteProduct = await prisma.product.findFirstOrThrow({ where: { name: 'Latte' } });
  const cappuccinoProduct = await prisma.product.findFirstOrThrow({
    where: { name: 'Cappuccino' },
  });
  const mochaProduct = await prisma.product.findFirstOrThrow({ where: { name: 'Mocha' } });
  const americanoProduct = await prisma.product.findFirstOrThrow({
    where: { name: 'Americano' },
  });

  await prisma.productModifierGroup.createMany({
    data: [
      { product_id: latteProduct.id, modifier_group_id: milkGroup.id },
      { product_id: latteProduct.id, modifier_group_id: extrasGroup.id },
      { product_id: latteProduct.id, modifier_group_id: sweetenerGroup.id },
      { product_id: cappuccinoProduct.id, modifier_group_id: milkGroup.id },
      { product_id: cappuccinoProduct.id, modifier_group_id: extrasGroup.id },
      { product_id: cappuccinoProduct.id, modifier_group_id: sweetenerGroup.id },
      { product_id: mochaProduct.id, modifier_group_id: milkGroup.id },
      { product_id: mochaProduct.id, modifier_group_id: extrasGroup.id },
      { product_id: americanoProduct.id, modifier_group_id: extrasGroup.id },
      { product_id: americanoProduct.id, modifier_group_id: sweetenerGroup.id },
    ],
  });

  // --------------------------------------------------------------------------
  // Sample sales — a handful of orders so reports have SALE movements to
  // aggregate. Each sale fires deductSaleFromInventory against the Barra rule.
  // --------------------------------------------------------------------------
  async function variantIdOf(productName: string, variantName: string): Promise<string> {
    const v = await prisma.productVariant.findFirstOrThrow({
      where: { name: variantName, product: { name: productName } },
      select: { id: true },
    });
    return v.id;
  }

  const latteMediumId = await variantIdOf('Latte', 'Medium 12oz');
  const latteLargeId = await variantIdOf('Latte', 'Large 16oz');
  const cappuccinoMediumId = await variantIdOf('Cappuccino', 'Medium 12oz');
  const americanoMediumId = await variantIdOf('Americano', 'Medium 12oz');
  const mochaLargeId = await variantIdOf('Mocha', 'Large 16oz');

  const almondModifier = await prisma.modifier.findFirstOrThrow({
    where: { name: 'Almond Milk' },
  });
  const extraShotModifier = await prisma.modifier.findFirstOrThrow({
    where: { name: 'Extra Shot' },
  });
  const vanillaModifier = await prisma.modifier.findFirstOrThrow({
    where: { name: 'Vanilla Syrup', group: { name: 'Extras' } },
  });

  const waterProduct = await prisma.product.findFirstOrThrow({
    where: { name: 'Bottled Water' },
  });

  // Four representative sales. Ids are synthetic — no Order model exists yet.
  await deductSaleFromInventory(
    [
      {
        product_id: latteProduct.id,
        variant_id: latteMediumId,
        quantity: 2,
        modifier_ids: [sugarModifier.id],
      },
      { product_id: waterProduct.id, quantity: 1 },
    ],
    null,
    randomUUID(),
  );

  await deductSaleFromInventory(
    [
      {
        product_id: latteProduct.id,
        variant_id: latteLargeId,
        quantity: 1,
        modifier_ids: [almondModifier.id, extraShotModifier.id],
      },
      {
        product_id: cappuccinoProduct.id,
        variant_id: cappuccinoMediumId,
        quantity: 1,
      },
    ],
    null,
    randomUUID(),
  );

  await deductSaleFromInventory(
    [
      {
        product_id: mochaProduct.id,
        variant_id: mochaLargeId,
        quantity: 1,
        modifier_ids: [vanillaModifier.id],
      },
      {
        product_id: americanoProduct.id,
        variant_id: americanoMediumId,
        quantity: 2,
      },
    ],
    null,
    randomUUID(),
  );

  await deductSaleFromInventory(
    [{ product_id: waterProduct.id, quantity: 6 }],
    null,
    randomUUID(),
  );

  // A spilled 50g of espresso at the bar — gives the variance report a
  // non-zero delta between theoretical (recipe-only) and actual usage.
  const writeOff = await prisma.writeOff.create({
    data: {
      storage_id: barra.id,
      supply_id: espresso.id,
      quantity: 0.05,
      reason: 'SPILLED',
      notes: 'Bag tipped over during restock',
      date: new Date(),
      user_id: admin.id,
    },
  });
  await prisma.storageStock.update({
    where: { supply_id_storage_id: { supply_id: espresso.id, storage_id: barra.id } },
    data: { quantity: { decrement: 0.05 } },
  });
  const espressoSupply = await prisma.supply.findUniqueOrThrow({
    where: { id: espresso.id },
    select: { average_cost: true },
  });
  await prisma.stockMovement.create({
    data: {
      supply_id: espresso.id,
      storage_id: barra.id,
      type: 'WRITE_OFF',
      quantity: -0.05,
      reference_type: 'WriteOff',
      reference_id: writeOff.id,
      unit_cost: espressoSupply.average_cost,
    },
  });

  // --------------------------------------------------------------------------
  // Phase 8 — Employees, attendance, and payroll seed.
  //
  // Three salaried employees plus a full week of attendance so the payroll
  // generate endpoint has realistic data to summarize. Week runs Mon→Sun
  // relative to today's date, picking the most recent Monday as week_start.
  // --------------------------------------------------------------------------
  const baristaHash = await hashPassword('barista123');
  const [sofia, carlos, lucia] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Sofía Hernández',
        email: 'sofia@pos.local',
        pin: '2001',
        password_hash: baristaHash,
        role: 'BARISTA',
        weekly_salary: 600000,
        hire_date: new Date('2025-06-15T00:00:00Z'),
        position: 'Barista',
        phone: '+52 81 2000 1001',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Carlos Mendoza',
        email: 'carlos@pos.local',
        pin: '2002',
        password_hash: baristaHash,
        role: 'CASHIER',
        weekly_salary: 550000,
        hire_date: new Date('2025-09-01T00:00:00Z'),
        position: 'Cajero',
        phone: '+52 81 2000 1002',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Lucía Ramírez',
        email: 'lucia@pos.local',
        pin: '2003',
        password_hash: baristaHash,
        role: 'MANAGER',
        weekly_salary: 900000,
        hire_date: new Date('2024-11-10T00:00:00Z'),
        position: 'Gerente',
        phone: '+52 81 2000 1003',
      },
    }),
  ]);

  // Pick the Monday on/before today as week_start for attendance seed.
  const today = new Date();
  const utcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayOfWeek = utcMidnight.getUTCDay(); // Sun=0, Mon=1, ...
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = new Date(utcMidnight);
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);

  function dayOf(offset: number): Date {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  }

  const attendanceRecords: Prisma.AttendanceCreateManyInput[] = [];
  // Sofía: perfect week Mon–Sat, day off Sunday.
  for (let i = 0; i < 6; i++) {
    attendanceRecords.push({
      user_id: sofia.id,
      date: dayOf(i),
      status: 'PRESENT',
      recorded_by: admin.id,
    });
  }
  attendanceRecords.push({
    user_id: sofia.id,
    date: dayOf(6),
    status: 'DAY_OFF',
    recorded_by: admin.id,
  });

  // Carlos: one unpaid no-show (Wed), one late day (Fri), worked the rest.
  const carlosStatuses: Array<{ offset: number; status: 'PRESENT' | 'LATE' | 'ABSENT' | 'DAY_OFF'; is_paid?: boolean; reason?: string }> = [
    { offset: 0, status: 'PRESENT' },
    { offset: 1, status: 'PRESENT' },
    { offset: 2, status: 'ABSENT', is_paid: false, reason: 'No-show' },
    { offset: 3, status: 'PRESENT' },
    { offset: 4, status: 'LATE', reason: 'Traffic' },
    { offset: 5, status: 'PRESENT' },
    { offset: 6, status: 'DAY_OFF' },
  ];
  for (const r of carlosStatuses) {
    attendanceRecords.push({
      user_id: carlos.id,
      date: dayOf(r.offset),
      status: r.status,
      is_paid: r.is_paid ?? true,
      reason: r.reason,
      recorded_by: admin.id,
    });
  }

  // Lucía: sick day paid (Tue), otherwise present.
  const luciaStatuses: Array<{ offset: number; status: 'PRESENT' | 'LATE' | 'ABSENT' | 'DAY_OFF'; is_paid?: boolean; reason?: string }> = [
    { offset: 0, status: 'PRESENT' },
    { offset: 1, status: 'ABSENT', is_paid: true, reason: 'Sick' },
    { offset: 2, status: 'PRESENT' },
    { offset: 3, status: 'PRESENT' },
    { offset: 4, status: 'PRESENT' },
    { offset: 5, status: 'PRESENT' },
    { offset: 6, status: 'DAY_OFF' },
  ];
  for (const r of luciaStatuses) {
    attendanceRecords.push({
      user_id: lucia.id,
      date: dayOf(r.offset),
      status: r.status,
      is_paid: r.is_paid ?? true,
      reason: r.reason,
      recorded_by: admin.id,
    });
  }

  await prisma.attendance.createMany({ data: attendanceRecords });

  console.log('Seed complete.');
  console.log(`  Supplier: ${supplier.name}`);
  console.log(`  Storages: ${bodega.name}, ${barra.name}`);
  console.log('  Products: Latte ×3, Cappuccino ×3, Americano ×2, Mocha ×3, Bottled Water');
  console.log('  Preparations: Simple Syrup, Mocha Sauce');
  console.log('  Purchases: 2 confirmed (Bodega + Barra) — WAC and stock populated');
  console.log('  Sales: 4 sample orders — SALE movements written for variance reports');
  console.log(`  Employees: ${sofia.name}, ${carlos.name}, ${lucia.name}`);
  console.log(`  Attendance: ${attendanceRecords.length} records for week of ${weekStart.toISOString().slice(0, 10)}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
