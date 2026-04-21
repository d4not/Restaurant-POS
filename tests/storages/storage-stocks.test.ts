import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeUser,
  makeStorage,
  makeSupplyCategory,
  makeSupply,
  seedStock,
} from '../helpers/factories.js';

const app = getTestApp();

// `low_only=true` needs a column-vs-column comparison (`quantity <= min_stock`)
// which Prisma can't express in findMany — the previous implementation filtered
// in app code after pagination, which let pages come back under-filled or empty
// when a later cursor page contained all the matches. These tests cover both
// the correctness of the filter and its interaction with the cursor.

async function setup() {
  const [user, storage, cat] = await Promise.all([
    makeUser(),
    makeStorage({ name: 'Barra' }),
    makeSupplyCategory({ name: 'Dairy' }),
  ]);
  const auth = authHeader(user.id);

  // 5 stocked supplies, only 2 actually below threshold.
  const supplies = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      makeSupply({
        category_id: cat.id,
        name: `Supply ${i}`,
        base_unit: 'BOTTLE',
        content_per_unit: 1000,
        content_unit: 'ML',
      }),
    ),
  );
  // Index 0 and 3 are below threshold; others are above.
  const rows = [
    { qty: 1, min: 5 }, // below
    { qty: 10, min: 5 }, // above
    { qty: 20, min: 5 }, // above
    { qty: 2, min: 3 }, // below
    { qty: 50, min: 5 }, // above
  ];
  for (let i = 0; i < supplies.length; i += 1) {
    await seedStock({
      supply_id: supplies[i]!.id,
      storage_id: storage.id,
      quantity: rows[i]!.qty,
      min_stock: rows[i]!.min,
    });
  }

  return { auth, storageId: storage.id };
}

describe('GET /api/v1/storages/:id/stocks — low_only filter', () => {
  it('returns only stocks where quantity <= min_stock', async () => {
    const s = await setup();
    const res = await request(app)
      .get(`/api/v1/storages/${s.storageId}/stocks?low_only=true`)
      .set(s.auth)
      .expect(200);

    const items = res.body.data.items as Array<{ quantity: string; min_stock: string }>;
    expect(items).toHaveLength(2);
    for (const row of items) {
      const qty = Number(row.quantity);
      const min = Number(row.min_stock);
      expect(qty).toBeLessThanOrEqual(min);
    }
  });

  it('still paginates correctly when low_only constrains the result set', async () => {
    const s = await setup();
    const res = await request(app)
      .get(`/api/v1/storages/${s.storageId}/stocks?low_only=true&limit=1`)
      .set(s.auth)
      .expect(200);
    // With 2 matches and limit=1, the first page has 1 item and a next cursor.
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(
        `/api/v1/storages/${s.storageId}/stocks?low_only=true&limit=1&cursor=${res.body.data.nextCursor}`,
      )
      .set(s.auth)
      .expect(200);
    expect(page2.body.data.items).toHaveLength(1);
  });

  it('returns an empty page when nothing is low and does not stall pagination', async () => {
    const [user, storage, cat] = await Promise.all([
      makeUser(),
      makeStorage(),
      makeSupplyCategory(),
    ]);
    const supply = await makeSupply({ category_id: cat.id, base_unit: 'PIECE' });
    await seedStock({
      supply_id: supply.id,
      storage_id: storage.id,
      quantity: 100,
      min_stock: 5,
    });
    const res = await request(app)
      .get(`/api/v1/storages/${storage.id}/stocks?low_only=true`)
      .set(authHeader(user.id))
      .expect(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.nextCursor).toBeNull();
  });
});
