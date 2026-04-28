import request from 'supertest';
import type { Express } from 'express';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupply,
  makeSupplyCategory,
  makeUser,
  seedStock,
} from '../helpers/factories.js';

// Lightweight scenario for the shift / daily-report lifecycle tests. A single
// CASHIER, one stocked PRODUCT-typed Espresso (5000 centavos / 50.00),
// and a default deduction rule pointed at the bar storage. PRODUCT (vs DISH)
// is intentional — payment deducts 1 supply unit per line and skips the
// recipe engine, which we don't want to retest here.
export interface LifecycleScenario {
  cashier: { id: string; auth: Record<string, string> };
  productId: string;
  storageId: string;
}

export async function seedLifecycle(app: Express): Promise<LifecycleScenario> {
  const user = await makeUser({ role: 'CASHIER' });
  const auth = authHeader(user.id, 'CASHIER');

  const storage = await makeStorage({ name: 'Bar' });
  const category = await makeSupplyCategory({ name: 'Drinks' });
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Espresso shot',
    base_unit: 'PIECE',
  });
  // 1000 supply units is plenty for any single-shift test; average_cost is
  // irrelevant to the report layer (we never assert on COGS here).
  await seedStock({
    supply_id: supply.id,
    storage_id: storage.id,
    quantity: 1000,
    average_cost: 100,
  });

  const product = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ name: 'Espresso', type: 'PRODUCT', sell_price: 5000, supply_id: supply.id })
    .expect(201);

  // Default deduction rule (no register filter) so any shift opened in this
  // scenario can fulfill orders without re-wiring per-shift rules.
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ storage_id: storage.id })
    .expect(201);

  return {
    cashier: { id: user.id, auth },
    productId: product.body.data.id as string,
    storageId: storage.id,
  };
}

export async function openShift(
  app: Express,
  auth: Record<string, string>,
  opening: number,
  notes?: string,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: opening, ...(notes ? { notes } : {}) })
    .expect(201);
  return res.body.data.id as string;
}

export async function closeShift(
  app: Express,
  auth: Record<string, string>,
  registerId: string,
  actualAmount: number,
): Promise<unknown> {
  const res = await request(app)
    .post(`/api/v1/registers/${registerId}/close`)
    .set(auth)
    .send({ actual_amount: actualAmount })
    .expect(200);
  return res.body.data;
}

export async function payCashOrder(
  app: Express,
  auth: Record<string, string>,
  registerId: string,
  productId: string,
  quantity: number,
  payAmount: number,
): Promise<string> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: registerId, order_type: 'DINE_IN' })
    .expect(201);
  const orderId = order.body.data.id as string;
  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(auth)
    .send({ product_id: productId, quantity })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${orderId}/payments`)
    .set(auth)
    .send({ method: 'CASH', amount: payAmount })
    .expect(201);
  return orderId;
}

// Open + add an item but do NOT pay — used to seed cancellable orders for
// the void-count alert scenarios.
export async function openOrderWithItem(
  app: Express,
  auth: Record<string, string>,
  registerId: string,
  productId: string,
  quantity = 1,
): Promise<string> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: registerId, order_type: 'DINE_IN' })
    .expect(201);
  const orderId = order.body.data.id as string;
  await request(app)
    .post(`/api/v1/orders/${orderId}/items`)
    .set(auth)
    .send({ product_id: productId, quantity })
    .expect(201);
  return orderId;
}

export async function cancelOrder(
  app: Express,
  auth: Record<string, string>,
  orderId: string,
  reason = 'customer left',
): Promise<void> {
  await request(app)
    .delete(`/api/v1/orders/${orderId}`)
    .set(auth)
    .send({ reason })
    .expect(200);
}
