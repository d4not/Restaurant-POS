import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ProductType } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { deductSaleFromInventory } from '../../src/modules/sales/service.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeStorage,
  makeSupplyCategory,
  makeSupply,
} from '../helpers/factories.js';

const app = getTestApp();

// These guards protect the deduction engine and the recipe editor against
// states the schema can't catch on its own.

describe('DISH without a recipe', () => {
  it('surfaces a clear BadRequestError when sold', async () => {
    const [user, storage, cat] = await Promise.all([
      makeUser(),
      makeStorage(),
      makeSupplyCategory(),
    ]);
    // Supply that's never used — keeps the factories happy.
    await makeSupply({ category_id: cat.id, base_unit: 'PIECE' });
    await prisma.deductionRule.create({
      data: { station_id: null, pos_register_id: null, storage_id: storage.id },
    });

    const dish = await prisma.product.create({
      data: { name: 'Latte Sin Receta', type: ProductType.DISH },
    });

    await expect(
      deductSaleFromInventory(
        [{ product_id: dish.id, quantity: 1 }],
        null,
        randomUUID(),
      ),
    ).rejects.toThrow(/has no recipe/);

    // Nothing was written.
    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(0);
  });
});

describe('Preparation recipe yield invariant', () => {
  it('rejects an update that would clear yield_quantity on a PREPARATION recipe', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);

    const prep = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Test Syrup',
      type: 'PREPARATION',
    });
    expect(prep.status).toBe(201);

    const recipeRes = await request(app)
      .post(`/api/v1/recipes/products/${prep.body.data.id}`)
      .set(auth)
      .send({ yield_quantity: 100, yield_unit: 'ml', items: [] });
    expect(recipeRes.status).toBe(201);

    const patch = await request(app)
      .patch(`/api/v1/recipes/${recipeRes.body.data.id}`)
      .set(auth)
      .send({ yield_quantity: null });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects an update that would clear yield_unit on a PREPARATION recipe', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);

    const prep = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Test Syrup 2',
      type: 'PREPARATION',
    });
    const recipeRes = await request(app)
      .post(`/api/v1/recipes/products/${prep.body.data.id}`)
      .set(auth)
      .send({ yield_quantity: 100, yield_unit: 'ml', items: [] });

    const patch = await request(app)
      .patch(`/api/v1/recipes/${recipeRes.body.data.id}`)
      .set(auth)
      .send({ yield_unit: null });
    expect(patch.status).toBe(400);
  });

  it('still allows updating yield_quantity to a new positive value', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);

    const prep = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Test Syrup 3',
      type: 'PREPARATION',
    });
    const recipeRes = await request(app)
      .post(`/api/v1/recipes/products/${prep.body.data.id}`)
      .set(auth)
      .send({ yield_quantity: 100, yield_unit: 'ml', items: [] });

    const patch = await request(app)
      .patch(`/api/v1/recipes/${recipeRes.body.data.id}`)
      .set(auth)
      .send({ yield_quantity: 250 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.yield_quantity).toBe('250');
  });
});

describe('Recipe item self-reference guard', () => {
  it('rejects a preparation that references itself as an ingredient', async () => {
    const user = await makeUser();
    const auth = authHeader(user.id);

    const prep = await request(app).post('/api/v1/products').set(auth).send({
      name: 'Recursive Prep',
      type: 'PREPARATION',
    });
    expect(prep.status).toBe(201);
    const prepId = prep.body.data.id as string;

    const recipeRes = await request(app)
      .post(`/api/v1/recipes/products/${prepId}`)
      .set(auth)
      .send({ yield_quantity: 100, yield_unit: 'ml', items: [] });
    expect(recipeRes.status).toBe(201);

    // Trying to add this preparation to its own recipe must be blocked.
    const res = await request(app)
      .post(`/api/v1/recipes/${recipeRes.body.data.id}/items`)
      .set(auth)
      .send({ preparation_id: prepId, quantity: 10, unit: 'ml' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot reference itself/);
  });
});
