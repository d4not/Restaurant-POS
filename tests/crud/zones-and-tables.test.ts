import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

describe('Zones CRUD', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('creates, lists, updates, and soft-deletes a zone', async () => {
    const create = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor', display_order: 1 });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data.active).toBe(true);

    const update = await request(app)
      .patch(`/api/v1/zones/${id}`)
      .set(auth)
      .send({ display_order: 5 });
    expect(update.status).toBe(200);
    expect(update.body.data.display_order).toBe(5);

    const list = await request(app).get('/api/v1/zones').set(auth);
    expect(list.body.data.items).toHaveLength(1);

    await request(app).delete(`/api/v1/zones/${id}`).set(auth).expect(204);
    const row = await prisma.zone.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(false);
  });

  it('orders zones by display_order then name', async () => {
    await request(app).post('/api/v1/zones').set(auth).send({ name: 'Bar', display_order: 3 });
    await request(app).post('/api/v1/zones').set(auth).send({ name: 'Indoor', display_order: 1 });
    await request(app).post('/api/v1/zones').set(auth).send({ name: 'Terrace', display_order: 2 });

    const list = await request(app).get('/api/v1/zones').set(auth);
    expect(list.body.data.items.map((z: { name: string }) => z.name)).toEqual([
      'Indoor',
      'Terrace',
      'Bar',
    ]);
  });

  it('include_tables=true embeds tables sorted by number', async () => {
    const zone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor' });
    const zoneId = zone.body.data.id as string;
    await request(app).post('/api/v1/tables').set(auth).send({ zone_id: zoneId, number: 3 });
    await request(app).post('/api/v1/tables').set(auth).send({ zone_id: zoneId, number: 1 });
    await request(app).post('/api/v1/tables').set(auth).send({ zone_id: zoneId, number: 2 });

    const list = await request(app)
      .get('/api/v1/zones?include_tables=true')
      .set(auth);
    expect(list.body.data.items[0].tables.map((t: { number: number }) => t.number)).toEqual([1, 2, 3]);
  });
});

describe('Tables CRUD', () => {
  let auth: Record<string, string>;
  let zoneId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const z = await request(app).post('/api/v1/zones').set(auth).send({ name: 'Indoor' });
    zoneId = z.body.data.id;
  });

  it('creates with defaults (capacity 2, status AVAILABLE) and embeds zone in response', async () => {
    const res = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(2);
    expect(res.body.data.status).toBe('AVAILABLE');
    expect(res.body.data.zone.id).toBe(zoneId);
    expect(res.body.data.zone.name).toBe('Indoor');
  });

  it('rejects duplicate number within the same zone', async () => {
    await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 })
      .expect(201);
    const dup = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 });
    expect(dup.status).toBe(409);
  });

  it('allows the same table number in two different zones', async () => {
    const otherZone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Terrace' });
    await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 })
      .expect(201);
    await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: otherZone.body.data.id, number: 1 })
      .expect(201);
  });

  it('filters by zone_id and status', async () => {
    const otherZone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Terrace' });
    await request(app).post('/api/v1/tables').set(auth).send({ zone_id: zoneId, number: 1 });
    await request(app).post('/api/v1/tables').set(auth).send({ zone_id: zoneId, number: 2 });
    await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: otherZone.body.data.id, number: 1 });

    const indoor = await request(app)
      .get(`/api/v1/tables?zone_id=${zoneId}`)
      .set(auth);
    expect(indoor.body.data.items).toHaveLength(2);

    const terrace = await request(app)
      .get(`/api/v1/tables?zone_id=${otherZone.body.data.id}`)
      .set(auth);
    expect(terrace.body.data.items).toHaveLength(1);
  });

  it('PATCH /:id/status flips the status badge without touching other fields', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1, capacity: 4 });
    const id = create.body.data.id as string;

    const reserved = await request(app)
      .patch(`/api/v1/tables/${id}/status`)
      .set(auth)
      .send({ status: 'RESERVED' });
    expect(reserved.status).toBe(200);
    expect(reserved.body.data.status).toBe('RESERVED');
    expect(reserved.body.data.capacity).toBe(4);
  });

  it('rejects status updates with an invalid enum value', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 });
    const res = await request(app)
      .patch(`/api/v1/tables/${create.body.data.id}/status`)
      .set(auth)
      .send({ status: 'BUSY' });
    expect(res.status).toBe(422);
  });

  it('soft-deletes a table (active=false, row preserved for order history)', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 });
    await request(app).delete(`/api/v1/tables/${create.body.data.id}`).set(auth).expect(204);
    const row = await prisma.table.findUniqueOrThrow({
      where: { id: create.body.data.id },
    });
    expect(row.active).toBe(false);
  });
});
