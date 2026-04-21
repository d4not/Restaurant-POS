import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeSupplyCategory, makeSupply } from '../helpers/factories.js';
import { prisma } from '../../src/lib/prisma.js';

const app = getTestApp();

describe('Product categories', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('creates, nests, lists, updates, and rejects cycles', async () => {
    const parent = await request(app)
      .post('/api/v1/product-categories')
      .set(auth)
      .send({ name: 'Coffee' })
      .expect(201);

    const child = await request(app)
      .post('/api/v1/product-categories')
      .set(auth)
      .send({ name: 'Hot Coffee', parent_id: parent.body.data.id })
      .expect(201);

    const list = await request(app)
      .get(`/api/v1/product-categories?parent_id=${parent.body.data.id}`)
      .set(auth);
    expect(list.body.data.items).toHaveLength(1);

    const roots = await request(app)
      .get('/api/v1/product-categories?parent_id=null')
      .set(auth);
    expect(roots.body.data.items).toHaveLength(1);

    const cycleAttempt = await request(app)
      .patch(`/api/v1/product-categories/${parent.body.data.id}`)
      .set(auth)
      .send({ parent_id: child.body.data.id });
    expect(cycleAttempt.status).toBe(400);
  });

  it('rejects deleting a category that has subcategories', async () => {
    const parent = await request(app)
      .post('/api/v1/product-categories')
      .set(auth)
      .send({ name: 'Food' })
      .expect(201);
    await request(app)
      .post('/api/v1/product-categories')
      .set(auth)
      .send({ name: 'Breakfast', parent_id: parent.body.data.id })
      .expect(201);

    const del = await request(app)
      .delete(`/api/v1/product-categories/${parent.body.data.id}`)
      .set(auth);
    expect(del.status).toBe(409);
  });
});

describe('Products CRUD + variants + modifier-group linking', () => {
  let auth: Record<string, string>;
  let categoryId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const categoryRes = await request(app)
      .post('/api/v1/product-categories')
      .set(auth)
      .send({ name: 'Coffee' });
    categoryId = categoryRes.body.data.id;
  });

  it('creates a DISH product, attaches variants, and manages modifier groups', async () => {
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Latte',
        type: 'DISH',
        category_id: categoryId,
      });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;

    const small = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth)
      .send({ name: 'Small 8oz', sell_price: 4500 });
    expect(small.status).toBe(201);
    const variantId = small.body.data.id as string;

    const listVariants = await request(app)
      .get(`/api/v1/products/${productId}/variants`)
      .set(auth);
    expect(listVariants.body.data).toHaveLength(1);

    const patched = await request(app)
      .patch(`/api/v1/products/${productId}/variants/${variantId}`)
      .set(auth)
      .send({ sell_price: 4800 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.sell_price.toString()).toBe('4800');

    const group = await request(app)
      .post('/api/v1/modifier-groups')
      .set(auth)
      .send({ name: 'Milk Type', max_selection: 1 });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;

    const attach = await request(app)
      .post(`/api/v1/products/${productId}/modifier-groups`)
      .set(auth)
      .send({ modifier_group_id: groupId });
    expect(attach.status).toBe(201);

    // Attaching twice is a CONFLICT.
    const dup = await request(app)
      .post(`/api/v1/products/${productId}/modifier-groups`)
      .set(auth)
      .send({ modifier_group_id: groupId });
    expect(dup.status).toBe(409);

    const links = await request(app)
      .get(`/api/v1/products/${productId}/modifier-groups`)
      .set(auth);
    expect(links.body.data).toHaveLength(1);

    await request(app)
      .delete(`/api/v1/products/${productId}/modifier-groups/${groupId}`)
      .set(auth)
      .expect(204);

    await request(app)
      .delete(`/api/v1/products/${productId}/variants/${variantId}`)
      .set(auth)
      .expect(204);

    await request(app).delete(`/api/v1/products/${productId}`).set(auth).expect(204);
  });

  it('rejects creating variants on a non-DISH product', async () => {
    const cat = await makeSupplyCategory();
    const supply = await makeSupply({ category_id: cat.id });
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({
        name: 'Bottled Water',
        type: 'PRODUCT',
        sell_price: 2500,
        supply_id: supply.id,
      });
    expect(product.status).toBe(201);

    const variant = await request(app)
      .post(`/api/v1/products/${product.body.data.id}/variants`)
      .set(auth)
      .send({ name: 'Large', sell_price: 2500 });
    expect(variant.status).toBe(400);
  });
});

describe('Modifier groups and modifiers', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('rejects min > max on update', async () => {
    const group = await request(app)
      .post('/api/v1/modifier-groups')
      .set(auth)
      .send({ name: 'Sweetener', min_selection: 0, max_selection: 2 });
    const res = await request(app)
      .patch(`/api/v1/modifier-groups/${group.body.data.id}`)
      .set(auth)
      .send({ min_selection: 5 });
    expect(res.status).toBe(400);
  });

  it('creates modifiers within a group and validates supply triplet', async () => {
    const cat = await makeSupplyCategory();
    const supply = await makeSupply({
      category_id: cat.id,
      base_unit: 'BOTTLE',
      content_per_unit: 946,
      content_unit: 'ML',
    });
    const group = await request(app)
      .post('/api/v1/modifier-groups')
      .set(auth)
      .send({ name: 'Milk Type' })
      .expect(201);
    const groupId = group.body.data.id as string;

    const mod = await request(app)
      .post(`/api/v1/modifier-groups/${groupId}/modifiers`)
      .set(auth)
      .send({
        name: 'Almond Milk',
        extra_price: 1500,
        supply_id: supply.id,
        supply_quantity: 200,
        supply_unit: 'ML',
      });
    expect(mod.status).toBe(201);
    const modifierId = mod.body.data.id as string;

    const getMod = await request(app)
      .get(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`)
      .set(auth);
    expect(getMod.body.data.name).toBe('Almond Milk');

    const patch = await request(app)
      .patch(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`)
      .set(auth)
      .send({ extra_price: 1800 });
    expect(patch.status).toBe(200);

    // Clearing just one field of the triplet violates the invariant.
    const brokenTriplet = await request(app)
      .patch(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`)
      .set(auth)
      .send({ supply_id: null });
    expect(brokenTriplet.status).toBe(400);

    // Confirm supply is still linked correctly after the rollback.
    const check = await prisma.modifier.findUniqueOrThrow({ where: { id: modifierId } });
    expect(check.supply_id).toBe(supply.id);

    await request(app)
      .delete(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`)
      .set(auth)
      .expect(204);
  });
});
