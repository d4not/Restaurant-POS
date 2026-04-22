import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
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

// Phase 9A audit — ModifierProductOverride edge cases:
//   • unit-family validation at save time, not just at sale time
//   • multi-product overrides for the same modifier (allowed)
//   • per-product (product, modifier) unique constraint (rejected via 409)
//   • cascade delete when the modifier is removed
//   • Zod rejection of zero / negative quantities and ratios

interface Seed {
  auth: Record<string, string>;
  milkSupplyId: string;     // BOTTLE / ML
  espressoSupplyId: string; // BAG / G
  latteProductId: string;
  frappeProductId: string;
  milkGroupId: string;
  almondModifierId: string;
  extrasGroupId: string;
  extraShotModifierId: string;
}

async function seedScenario(): Promise<Seed> {
  const [user, , , dairyCat, coffeeCat] = await Promise.all([
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

  const category = await request(app)
    .post('/api/v1/product-categories')
    .set(auth)
    .send({ name: 'Hot Coffee' })
    .expect(201);

  const latte = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Latte', type: 'DISH', category_id: category.body.data.id, sell_price: 7500 })
    .expect(201);
  const frappe = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Frappe', type: 'DISH', category_id: category.body.data.id, sell_price: 8500 })
    .expect(201);

  // SWAP group for milk, used to test RATIO overrides. Whole Milk is the
  // is_default fallback so the group is wireable to a recipe slot.
  const milkGroup = await request(app)
    .post('/api/v1/modifier-groups')
    .set(auth)
    .send({
      name: 'Milk Type',
      type: 'SWAP',
      min_selection: 0,
      max_selection: 1,
    })
    .expect(201);
  await request(app)
    .post(`/api/v1/modifier-groups/${milkGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Whole Milk',
      supply_id: milk.id,
      ratio: 1,
      is_default: true,
      extra_price: 0,
    })
    .expect(201);
  const almondMod = await request(app)
    .post(`/api/v1/modifier-groups/${milkGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({ name: 'Almond Milk', supply_id: almond.id, ratio: 0.75, extra_price: 1000 })
    .expect(201);

  // ADD group for an espresso shot — used to test FIXED_QTY overrides (and to
  // force unit-family mismatches in negative-path tests).
  const extrasGroup = await request(app)
    .post('/api/v1/modifier-groups')
    .set(auth)
    .send({ name: 'Extras', type: 'ADD', max_selection: 3 })
    .expect(201);
  const extraShot = await request(app)
    .post(`/api/v1/modifier-groups/${extrasGroup.body.data.id}/modifiers`)
    .set(auth)
    .send({
      name: 'Extra Shot',
      supply_id: espresso.id,
      supply_quantity: 18,
      supply_unit: 'g',
      extra_price: 1500,
    })
    .expect(201);

  return {
    auth,
    milkSupplyId: milk.id,
    espressoSupplyId: espresso.id,
    latteProductId: latte.body.data.id,
    frappeProductId: frappe.body.data.id,
    milkGroupId: milkGroup.body.data.id,
    almondModifierId: almondMod.body.data.id,
    extrasGroupId: extrasGroup.body.data.id,
    extraShotModifierId: extraShot.body.data.id,
  };
}

describe('Phase 9A audit — override validation (Zod)', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedScenario();
  });

  // Schema-layer (Zod) failures surface as 422 per the API conventions in
  // CLAUDE.md. Service-layer BadRequestErrors surface as 400.
  it('rejects override_quantity = 0 on a FIXED_QTY override', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 0,
        override_unit: 'g',
      });
    expect(res.status).toBe(422);
  });

  it('rejects override_ratio = 0 on a RATIO override', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0,
      });
    expect(res.status).toBe(422);
  });

  it('rejects RATIO overrides that also carry override_quantity/unit', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0.5,
        override_quantity: 100,
        override_unit: 'ml',
      });
    expect(res.status).toBe(422);
  });

  it('rejects FIXED_QTY overrides missing quantity or unit', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 20,
        // no override_unit
      });
    expect(res.status).toBe(422);
  });
});

describe('Phase 9A audit — override unit-family compatibility', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('rejects a FIXED_QTY override whose unit is in a different family than the modifier supply', async () => {
    // Extra Shot's supply is espresso beans measured in grams (weight family).
    // Trying to override it with "ml" (volume family) must be rejected at save
    // time — not silently accepted and then blow up during a sale.
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 20,
        override_unit: 'ml',
      });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/family/i);
  });

  it('accepts a FIXED_QTY override whose unit is a different scale in the same family (g vs kg)', async () => {
    const res = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 0.02, // 0.02 kg = 20 g, compatible with weight family
        override_unit: 'kg',
      });
    expect(res.status).toBe(201);
  });

  it('rejects switching an override to FIXED_QTY with an incompatible unit via PATCH', async () => {
    // Start with a valid RATIO override, then try to convert it to FIXED_QTY
    // with an incompatible unit — the service must re-validate on update.
    const created = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'RATIO',
        override_ratio: 0.5,
      })
      .expect(201);
    expect(created.body.data.override_type).toBe('RATIO');

    const res = await request(app)
      .patch(
        `/api/v1/products/${s.latteProductId}/modifier-overrides/${s.extraShotModifierId}`,
      )
      .set(s.auth)
      .send({
        override_type: 'FIXED_QTY',
        override_ratio: null,
        override_quantity: 50,
        override_unit: 'ml',
      });
    expect(res.status).toBe(400);
  });
});

describe('Phase 9A audit — override ownership and lifecycle', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seedScenario();
  });

  it('the same modifier can have overrides on multiple products independently', async () => {
    const onLatte = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0.75,
      });
    expect(onLatte.status).toBe(201);

    const onFrappe = await request(app)
      .post(`/api/v1/products/${s.frappeProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0.6,
      });
    expect(onFrappe.status).toBe(201);

    // Both rows coexist with different ratios.
    const latteRows = await request(app)
      .get(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .expect(200);
    const frappeRows = await request(app)
      .get(`/api/v1/products/${s.frappeProductId}/modifier-overrides`)
      .set(s.auth)
      .expect(200);
    expect(latteRows.body.data).toHaveLength(1);
    expect(latteRows.body.data[0].override_ratio).toBe('0.75');
    expect(frappeRows.body.data).toHaveLength(1);
    expect(frappeRows.body.data[0].override_ratio).toBe('0.6');
  });

  it('a second override for the same (product, modifier) pair returns 409', async () => {
    await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0.75,
      })
      .expect(201);

    const dup = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.almondModifierId,
        override_type: 'RATIO',
        override_ratio: 0.5,
      });
    expect(dup.status).toBe(409);
  });

  it('overrides are cascade-deleted when the modifier is deleted', async () => {
    const created = await request(app)
      .post(`/api/v1/products/${s.latteProductId}/modifier-overrides`)
      .set(s.auth)
      .send({
        modifier_id: s.extraShotModifierId,
        override_type: 'FIXED_QTY',
        override_quantity: 10,
        override_unit: 'g',
      })
      .expect(201);

    // Confirm it lands in the DB.
    const before = await prisma.modifierProductOverride.findUnique({
      where: { id: created.body.data.id },
    });
    expect(before).not.toBeNull();

    // Delete the modifier via the API.
    await request(app)
      .delete(
        `/api/v1/modifier-groups/${s.extrasGroupId}/modifiers/${s.extraShotModifierId}`,
      )
      .set(s.auth)
      .expect(204);

    // Prisma cascade should have removed the override too.
    const after = await prisma.modifierProductOverride.findUnique({
      where: { id: created.body.data.id },
    });
    expect(after).toBeNull();
  });
});
