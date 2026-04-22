import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeSupply,
  makeSupplyCategory,
} from '../helpers/factories.js';

const app = getTestApp();

// RecipeItem.modifier_group_id makes a line a "slot": the selected SWAP
// modifier (or the group's is_default modifier) provides the supply at sale
// time. These tests verify the CRUD invariants; the deduction behavior is
// covered in tests/sales/swap-modifiers.test.ts.

interface DishFixture {
  auth: Record<string, string>;
  dairyCatId: string;
  milkSupplyId: string;
  almondMilkSupplyId: string;
  milkGroupId: string;
  dishId: string;
  recipeId: string;
}

async function setupDish(): Promise<DishFixture> {
  const user = await makeUser();
  const auth = authHeader(user.id, 'ADMIN');
  const dairyCat = await makeSupplyCategory({ name: 'Dairy' });
  const milk = await makeSupply({
    category_id: dairyCat.id,
    name: 'Whole Milk',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });
  const almond = await makeSupply({
    category_id: dairyCat.id,
    name: 'Almond Milk',
    base_unit: 'BOTTLE',
    content_per_unit: 946,
    content_unit: 'ML',
  });

  const groupRes = await request(app).post('/api/v1/modifier-groups').set(auth).send({
    name: 'Milk Type',
    type: 'SWAP',
  });
  expect(groupRes.status).toBe(201);
  const milkGroupId = groupRes.body.data.id;

  // Whole Milk is the default — required before the group can be attached
  // to a recipe slot (otherwise the deduction engine has no fallback).
  await request(app)
    .post(`/api/v1/modifier-groups/${milkGroupId}/modifiers`)
    .set(auth)
    .send({
      name: 'Whole Milk',
      supply_id: milk.id,
      ratio: 1,
      is_default: true,
      extra_price: 0,
    })
    .expect(201);

  const dishRes = await request(app).post('/api/v1/products').set(auth).send({
    name: 'Latte',
    type: 'DISH',
    sell_price: 5500,
  });
  expect(dishRes.status).toBe(201);

  const recipeRes = await request(app)
    .post(`/api/v1/recipes/products/${dishRes.body.data.id}`)
    .set(auth)
    .send({});
  expect(recipeRes.status).toBe(201);

  return {
    auth,
    dairyCatId: dairyCat.id,
    milkSupplyId: milk.id,
    almondMilkSupplyId: almond.id,
    milkGroupId,
    dishId: dishRes.body.data.id,
    recipeId: recipeRes.body.data.id,
  };
}

describe('Recipe item modifier_group_id', () => {
  it('accepts a recipe line that references only a modifier_group_id (no supply_id)', async () => {
    const f = await setupDish();
    const res = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        modifier_group_id: f.milkGroupId,
        quantity: 200,
        unit: 'ml',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.modifier_group_id).toBe(f.milkGroupId);
    expect(res.body.data.supply_id).toBeNull();
  });

  it('embeds modifier_group metadata (including the is_default modifier) in GET', async () => {
    const f = await setupDish();
    await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        modifier_group_id: f.milkGroupId,
        quantity: 200,
        unit: 'ml',
      })
      .expect(201);

    const recipeRes = await request(app)
      .get(`/api/v1/recipes/products/${f.dishId}`)
      .set(f.auth);
    expect(recipeRes.status).toBe(200);
    const item = recipeRes.body.data.items.find(
      (i: { modifier_group_id: string | null }) => i.modifier_group_id === f.milkGroupId,
    );
    expect(item).toBeTruthy();
    expect(item.modifier_group).toMatchObject({
      id: f.milkGroupId,
      name: 'Milk Type',
      type: 'SWAP',
    });
    // The embedded group should include its modifiers so the UI can render
    // "default: Whole Milk" without a second fetch.
    const defaults = (item.modifier_group.modifiers ?? []).filter(
      (m: { is_default: boolean }) => m.is_default,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Whole Milk');
  });

  it('rejects a recipe line that combines supply_id and modifier_group_id', async () => {
    const f = await setupDish();
    const res = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        supply_id: f.milkSupplyId,
        modifier_group_id: f.milkGroupId,
        quantity: 200,
        unit: 'ml',
      });
    expect(res.status).toBe(422);
  });

  it('rejects modifier_group_id on an ADD group', async () => {
    const f = await setupDish();
    const addGroup = await request(app).post('/api/v1/modifier-groups').set(f.auth).send({
      name: 'Extras',
      type: 'ADD',
    });
    expect(addGroup.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        modifier_group_id: addGroup.body.data.id,
        quantity: 200,
        unit: 'ml',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/SWAP/);
  });

  it('rejects modifier_group_id on a SWAP group with no is_default modifier', async () => {
    const f = await setupDish();
    // Fresh SWAP group without any modifiers at all.
    const emptyGroup = await request(app)
      .post('/api/v1/modifier-groups')
      .set(f.auth)
      .send({ name: 'Bean Type', type: 'SWAP' })
      .expect(201);

    const res = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        modifier_group_id: emptyGroup.body.data.id,
        quantity: 200,
        unit: 'ml',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/default/i);
  });

  it('rejects modifier_group_id combined with preparation_id', async () => {
    const f = await setupDish();
    const prep = await request(app).post('/api/v1/products').set(f.auth).send({
      name: 'Some Prep',
      type: 'PREPARATION',
    });
    const prepRec = await request(app)
      .post(`/api/v1/recipes/products/${prep.body.data.id}`)
      .set(f.auth)
      .send({ yield_quantity: 100, yield_unit: 'ml' });
    expect(prepRec.status).toBe(201);

    const res = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        preparation_id: prep.body.data.id,
        modifier_group_id: f.milkGroupId,
        quantity: 10,
        unit: 'ml',
      });
    expect(res.status).toBe(422);
  });

  it('PATCH can convert a supply line into a modifier-group slot', async () => {
    const f = await setupDish();
    const created = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({ supply_id: f.milkSupplyId, quantity: 200, unit: 'ml' });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/v1/recipes/${f.recipeId}/items/${created.body.data.id}`)
      .set(f.auth)
      .send({ supply_id: null, modifier_group_id: f.milkGroupId });
    expect(patched.status).toBe(200);
    expect(patched.body.data.modifier_group_id).toBe(f.milkGroupId);
    expect(patched.body.data.supply_id).toBeNull();
  });

  it('PATCH can swap a slot back to a plain supply line by clearing modifier_group_id', async () => {
    const f = await setupDish();
    const created = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        modifier_group_id: f.milkGroupId,
        quantity: 200,
        unit: 'ml',
      });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/v1/recipes/${f.recipeId}/items/${created.body.data.id}`)
      .set(f.auth)
      .send({ modifier_group_id: null, supply_id: f.milkSupplyId });
    expect(patched.status).toBe(200);
    expect(patched.body.data.modifier_group_id).toBeNull();
    expect(patched.body.data.supply_id).toBe(f.milkSupplyId);
  });

  it('PATCH updates quantity and waste_pct on an existing line', async () => {
    const f = await setupDish();
    const created = await request(app)
      .post(`/api/v1/recipes/${f.recipeId}/items`)
      .set(f.auth)
      .send({
        supply_id: f.milkSupplyId,
        quantity: 200,
        unit: 'ml',
        waste_pct: 0,
      });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/v1/recipes/${f.recipeId}/items/${created.body.data.id}`)
      .set(f.auth)
      .send({ quantity: 250, waste_pct: 5 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.quantity).toBe('250');
    expect(patched.body.data.waste_pct).toBe('5');
  });
});
