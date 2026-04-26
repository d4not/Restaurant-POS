import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

describe('FloorDecor CRUD', () => {
  let auth: Record<string, string>;
  let zoneId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const z = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor' });
    zoneId = z.body.data.id;
  });

  it('creates a bar counter with explicit geometry and label', async () => {
    const res = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({
        zone_id: zoneId,
        type: 'BAR_COUNTER',
        pos_x: 24,
        pos_y: 80,
        width: 272,
        height: 60,
        label: 'Main Bar',
        rotation: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'BAR_COUNTER',
      pos_x: 24,
      pos_y: 80,
      width: 272,
      height: 60,
      label: 'Main Bar',
      active: true,
    });
  });

  it('creates a decor plant with the schema defaults', async () => {
    const res = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'DECOR_PLANT' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'DECOR_PLANT',
      pos_x: 0,
      pos_y: 0,
      width: 80,
      height: 50,
      label: null,
    });
  });

  it('rejects unknown decor types', async () => {
    const res = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'TIKI_TORCH' });
    expect(res.status).toBe(422);
  });

  it('rejects creating decor in a non-existent zone', async () => {
    const res = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({
        zone_id: '00000000-0000-0000-0000-000000000000',
        type: 'BAR_COUNTER',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/zone/i);
  });

  it('lists with zone_id and type filters', async () => {
    const otherZone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Patio' });
    await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'BAR_COUNTER' });
    await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'DECOR_PLANT' });
    await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: otherZone.body.data.id, type: 'DECOR_PLANT' });

    const indoor = await request(app)
      .get(`/api/v1/floor-decor?zone_id=${zoneId}`)
      .set(auth);
    expect(indoor.body.data).toHaveLength(2);

    const plants = await request(app)
      .get('/api/v1/floor-decor?type=DECOR_PLANT')
      .set(auth);
    expect(plants.body.data).toHaveLength(2);
  });

  it('PATCHes geometry/label without touching type', async () => {
    const create = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'BAR_COUNTER', label: 'Bar' });
    const patch = await request(app)
      .patch(`/api/v1/floor-decor/${create.body.data.id}`)
      .set(auth)
      .send({ pos_x: 100, pos_y: 200, label: 'Long Bar' });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({
      type: 'BAR_COUNTER',
      pos_x: 100,
      pos_y: 200,
      label: 'Long Bar',
    });
  });

  it('clears label with null', async () => {
    const create = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'BAR_COUNTER', label: 'Bar' });
    const patch = await request(app)
      .patch(`/api/v1/floor-decor/${create.body.data.id}`)
      .set(auth)
      .send({ label: null });
    expect(patch.body.data.label).toBeNull();
  });

  it('hard-deletes a decor row', async () => {
    const create = await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'DECOR_PLANT' });
    await request(app)
      .delete(`/api/v1/floor-decor/${create.body.data.id}`)
      .set(auth)
      .expect(204);
    const row = await prisma.floorDecor.findUnique({
      where: { id: create.body.data.id },
    });
    expect(row).toBeNull();
  });

  it('cascades delete when the parent zone is removed', async () => {
    await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'BAR_COUNTER' });
    await prisma.zone.delete({ where: { id: zoneId } });
    const remaining = await prisma.floorDecor.count({ where: { zone_id: zoneId } });
    expect(remaining).toBe(0);
  });

  it('rejects non-admin users from creating decor', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    // The auth header carries the role inside the JWT — passing it here is
    // what makes requireRole evaluate against CASHIER instead of the default
    // ADMIN that the helper otherwise embeds.
    const cashierAuth = authHeader(cashier.id, 'CASHIER');
    const res = await request(app)
      .post('/api/v1/floor-decor')
      .set(cashierAuth)
      .send({ zone_id: zoneId, type: 'BAR_COUNTER' });
    expect(res.status).toBe(403);
  });
});
