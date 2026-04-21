import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser, makeSupplyCategory, makeSupply } from '../helpers/factories.js';

const app = getTestApp();

describe('Recipes CRUD', () => {
  let auth: Record<string, string>;
  let supplyId: string;

  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const cat = await makeSupplyCategory();
    supplyId = (
      await makeSupply({
        category_id: cat.id,
        base_unit: 'BOTTLE',
        content_per_unit: 946,
        content_unit: 'ML',
      })
    ).id;
  });

  it('creates a product recipe, adds/updates/removes items, and deletes it', async () => {
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({ name: 'Americano', type: 'DISH' });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;

    const recipe = await request(app)
      .post(`/api/v1/recipes/products/${productId}`)
      .set(auth)
      .send({
        items: [
          { supply_id: supplyId, quantity: 50, unit: 'ml' },
        ],
      });
    expect(recipe.status).toBe(201);
    const recipeId = recipe.body.data.id as string;

    const viaProduct = await request(app)
      .get(`/api/v1/recipes/products/${productId}`)
      .set(auth);
    expect(viaProduct.status).toBe(200);

    const add = await request(app)
      .post(`/api/v1/recipes/${recipeId}/items`)
      .set(auth)
      .send({ supply_id: supplyId, quantity: 30, unit: 'ml' });
    expect(add.status).toBe(201);
    const itemId = add.body.data.id as string;

    const update = await request(app)
      .patch(`/api/v1/recipes/${recipeId}/items/${itemId}`)
      .set(auth)
      .send({ quantity: 60 });
    expect(update.status).toBe(200);

    const recalc = await request(app)
      .post(`/api/v1/recipes/${recipeId}/recalculate`)
      .set(auth);
    expect(recalc.status).toBe(200);

    await request(app)
      .delete(`/api/v1/recipes/${recipeId}/items/${itemId}`)
      .set(auth)
      .expect(204);

    await request(app).delete(`/api/v1/recipes/${recipeId}`).set(auth).expect(204);

    const cleared = await prisma.recipe.findUnique({ where: { id: recipeId } });
    expect(cleared).toBeNull();
  });

  it('rejects a second recipe for the same product', async () => {
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({ name: 'Cappuccino', type: 'DISH' });
    expect(product.status).toBe(201);

    await request(app)
      .post(`/api/v1/recipes/products/${product.body.data.id}`)
      .set(auth)
      .send({ items: [] })
      .expect(201);

    const dup = await request(app)
      .post(`/api/v1/recipes/products/${product.body.data.id}`)
      .set(auth)
      .send({ items: [] });
    expect(dup.status).toBe(409);
  });

  it('creates a variant recipe nested under /recipes/variants/:variantId', async () => {
    const product = await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send({ name: 'Mocha', type: 'DISH' })
      .expect(201);
    const variant = await request(app)
      .post(`/api/v1/products/${product.body.data.id}/variants`)
      .set(auth)
      .send({ name: 'Medium', sell_price: 5500 })
      .expect(201);

    const recipe = await request(app)
      .post(`/api/v1/recipes/variants/${variant.body.data.id}`)
      .set(auth)
      .send({ items: [{ supply_id: supplyId, quantity: 200, unit: 'ml' }] });
    expect(recipe.status).toBe(201);

    const viaVariant = await request(app)
      .get(`/api/v1/recipes/variants/${variant.body.data.id}`)
      .set(auth);
    expect(viaVariant.status).toBe(200);
  });
});
