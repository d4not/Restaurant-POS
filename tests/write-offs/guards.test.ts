import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
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

describe('createWriteOff — active storage guard', () => {
  it('rejects a write-off against an inactive storage', async () => {
    const [user, storage, category] = await Promise.all([
      makeUser(),
      makeStorage(),
      makeSupplyCategory(),
    ]);
    const supply = await makeSupply({ category_id: category.id, base_unit: 'KG' });
    await seedStock({
      supply_id: supply.id,
      storage_id: storage.id,
      quantity: 5,
      average_cost: 100,
    });
    await prisma.storage.update({ where: { id: storage.id }, data: { active: false } });

    const res = await request(app)
      .post('/api/v1/write-offs')
      .set(authHeader(user.id))
      .send({
        storage_id: storage.id,
        supply_id: supply.id,
        quantity: 1,
        reason: 'EXPIRED',
        date: '2026-04-21T00:00:00Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/storage is inactive/i);
  });
});
