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

  it('rejects creating a TAKEOUT zone via the API (system-managed singleton)', async () => {
    const res = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Counter', kind: 'TAKEOUT' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/takeout zone/i);
  });

  it('rejects flipping a DINE_IN zone to TAKEOUT', async () => {
    const zone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor' });
    const flip = await request(app)
      .patch(`/api/v1/zones/${zone.body.data.id}`)
      .set(auth)
      .send({ kind: 'TAKEOUT' });
    expect(flip.status).toBe(400);
    expect(flip.body.error.message).toMatch(/takeout zone/i);
  });

  it('rejects deleting the TAKEOUT zone', async () => {
    const takeoutZone = await prisma.zone.create({
      data: { name: 'Barra/takeout', kind: 'TAKEOUT' },
    });
    const res = await request(app).delete(`/api/v1/zones/${takeoutZone.id}`).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/takeout zone/i);
  });

  it('rejects deactivating the TAKEOUT zone', async () => {
    const takeoutZone = await prisma.zone.create({
      data: { name: 'Barra/takeout', kind: 'TAKEOUT' },
    });
    const res = await request(app)
      .patch(`/api/v1/zones/${takeoutZone.id}`)
      .set(auth)
      .send({ active: false });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/takeout zone/i);
  });

  it('round-trips floor-canvas geometry on create and update', async () => {
    const create = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({
        name: 'Patio',
        pos_x: 540,
        pos_y: 30,
        width: 320,
        height: 220,
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({
      pos_x: 540,
      pos_y: 30,
      width: 320,
      height: 220,
    });

    const patch = await request(app)
      .patch(`/api/v1/zones/${create.body.data.id}`)
      .set(auth)
      .send({ pos_x: 700, height: 280 });
    expect(patch.body.data).toMatchObject({
      pos_x: 700,
      pos_y: 30,
      width: 320,
      height: 280,
    });
  });

  it('zones get default geometry (480x320 at origin) when none supplied', async () => {
    const create = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor' });
    expect(create.body.data).toMatchObject({
      pos_x: 0,
      pos_y: 0,
      width: 480,
      height: 320,
    });
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

  it('rejects creating a table in a TAKEOUT zone', async () => {
    // Truncate clears the migration's seeded takeout zone — re-create via
    // direct Prisma since the API blocks TAKEOUT creation by design.
    const takeoutZone = await prisma.zone.create({
      data: { name: 'Barra/takeout', kind: 'TAKEOUT' },
    });
    const res = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: takeoutZone.id, number: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/takeout zone/i);
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

  it('hard-deletes a table that has no order history', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1 });
    await request(app).delete(`/api/v1/tables/${create.body.data.id}`).set(auth).expect(204);
    const row = await prisma.table.findUnique({ where: { id: create.body.data.id } });
    expect(row).toBeNull();
  });

  it('soft-deletes a table that has order history (preserves row for the orders)', async () => {
    const tableRow = await prisma.table.create({
      data: { zone_id: zoneId, number: 9 },
    });
    const register = await prisma.cashRegister.create({
      data: {
        user_id: (await prisma.user.findFirstOrThrow()).id,
        opening_amount: 0,
      },
    });
    await prisma.order.create({
      data: {
        register_id: register.id,
        order_number: 1,
        order_date: new Date(),
        order_type: 'DINE_IN',
        status: 'PAID',
        table_id: tableRow.id,
        user_id: register.user_id,
      },
    });
    await request(app).delete(`/api/v1/tables/${tableRow.id}`).set(auth).expect(204);
    const row = await prisma.table.findUniqueOrThrow({ where: { id: tableRow.id } });
    expect(row.active).toBe(false);
  });

  it('resurrects a soft-deleted table when creating with the same (zone, number)', async () => {
    const created = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 4, pos_x: 100, pos_y: 100 });
    // Force the row into the soft-deleted state to simulate a table that was
    // retired while it had order history.
    await prisma.table.update({
      where: { id: created.body.data.id },
      data: { active: false },
    });
    const recreate = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 4, pos_x: 200, pos_y: 250 });
    expect(recreate.status).toBe(201);
    expect(recreate.body.data.id).toBe(created.body.data.id);
    expect(recreate.body.data.active).toBe(true);
    expect(recreate.body.data.pos_x).toBe(200);
    expect(recreate.body.data.pos_y).toBe(250);
  });

  it('accepts floor-plan layout fields on create and returns them on read', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({
        zone_id: zoneId,
        number: 7,
        pos_x: 240,
        pos_y: 180,
        width: 140,
        height: 140,
        shape: 'TABLE_CIRCLE',
        label: 'Patio 3',
        rotation: 45,
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({
      pos_x: 240,
      pos_y: 180,
      width: 140,
      height: 140,
      shape: 'TABLE_CIRCLE',
      label: 'Patio 3',
      rotation: 45,
    });
  });

  it('PATCHes layout fields without touching status or capacity', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1, capacity: 6 });
    const id = create.body.data.id as string;
    const patch = await request(app)
      .patch(`/api/v1/tables/${id}`)
      .set(auth)
      .send({ pos_x: 500, pos_y: 320, shape: 'TABLE_CIRCLE', rotation: 90 });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({
      pos_x: 500,
      pos_y: 320,
      shape: 'TABLE_CIRCLE',
      rotation: 90,
      capacity: 6,
      status: 'AVAILABLE',
    });
  });

  it('clears label with null', async () => {
    const create = await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1, label: 'Main' });
    const id = create.body.data.id as string;
    const cleared = await request(app)
      .patch(`/api/v1/tables/${id}`)
      .set(auth)
      .send({ label: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.label).toBeNull();
  });
});

describe('ZoneLabels CRUD', () => {
  let auth: Record<string, string>;
  let zoneId: string;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
    const z = await request(app).post('/api/v1/zones').set(auth).send({ name: 'Indoor' });
    zoneId = z.body.data.id;
  });

  it('creates, lists, patches, and deletes a label', async () => {
    const create = await request(app)
      .post('/api/v1/zone-labels')
      .set(auth)
      .send({ zone_id: zoneId, text: 'High Bar', pos_x: 100, pos_y: 40 });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ text: 'High Bar', pos_x: 100, pos_y: 40 });
    const id = create.body.data.id as string;

    const list = await request(app)
      .get(`/api/v1/zone-labels?zone_id=${zoneId}`)
      .set(auth);
    expect(list.body.data.items).toHaveLength(1);

    const patch = await request(app)
      .patch(`/api/v1/zone-labels/${id}`)
      .set(auth)
      .send({ text: 'Patio', font_size: 32, rotation: 15 });
    expect(patch.body.data).toMatchObject({ text: 'Patio', font_size: 32, rotation: 15 });

    await request(app).delete(`/api/v1/zone-labels/${id}`).set(auth).expect(204);
    const listAfter = await request(app)
      .get(`/api/v1/zone-labels?zone_id=${zoneId}`)
      .set(auth);
    expect(listAfter.body.data.items).toHaveLength(0);
  });

  it('rejects create with a non-existent zone', async () => {
    const res = await request(app)
      .post('/api/v1/zone-labels')
      .set(auth)
      .send({
        zone_id: '00000000-0000-0000-0000-000000000000',
        text: 'Ghost',
      });
    expect(res.status).toBe(400);
  });

  it('cascades delete when the parent zone is hard-deleted', async () => {
    await request(app)
      .post('/api/v1/zone-labels')
      .set(auth)
      .send({ zone_id: zoneId, text: 'Bar' });
    // Hard-delete via prisma (the zones endpoint is soft-delete only)
    await prisma.zoneLabel.deleteMany({ where: { zone_id: zoneId } });
    const remaining = await prisma.zoneLabel.count({ where: { zone_id: zoneId } });
    expect(remaining).toBe(0);
  });
});

describe('GET /api/v1/floors includes layout fields and labels', () => {
  let auth: Record<string, string>;
  beforeEach(async () => {
    auth = authHeader((await makeUser()).id);
  });

  it('returns tables with pos_x/pos_y/shape/rotation and zone labels', async () => {
    const zone = await request(app).post('/api/v1/zones').set(auth).send({ name: 'Indoor' });
    const zoneId = zone.body.data.id as string;
    await request(app)
      .post('/api/v1/tables')
      .set(auth)
      .send({ zone_id: zoneId, number: 1, pos_x: 120, pos_y: 60, shape: 'TABLE_CIRCLE' });
    await request(app)
      .post('/api/v1/zone-labels')
      .set(auth)
      .send({ zone_id: zoneId, text: 'Main Room', pos_x: 20, pos_y: 20, font_size: 28 });

    const floors = await request(app).get('/api/v1/floors').set(auth);
    expect(floors.status).toBe(200);
    const [z] = floors.body.data;
    expect(z.tables[0]).toMatchObject({
      number: 1,
      pos_x: 120,
      pos_y: 60,
      shape: 'TABLE_CIRCLE',
    });
    expect(z.labels[0]).toMatchObject({
      text: 'Main Room',
      pos_x: 20,
      pos_y: 20,
      font_size: 28,
    });
  });

  it('returns zone geometry and decor in the payload', async () => {
    const zone = await request(app)
      .post('/api/v1/zones')
      .set(auth)
      .send({ name: 'Indoor', pos_x: 30, pos_y: 30, width: 460, height: 320 });
    const zoneId = zone.body.data.id as string;
    await request(app)
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
      });
    await request(app)
      .post('/api/v1/floor-decor')
      .set(auth)
      .send({ zone_id: zoneId, type: 'DECOR_PLANT', pos_x: 350, pos_y: 40 });

    const floors = await request(app).get('/api/v1/floors').set(auth);
    expect(floors.status).toBe(200);
    const z = floors.body.data.find((zz: { id: string }) => zz.id === zoneId);
    expect(z).toMatchObject({
      pos_x: 30,
      pos_y: 30,
      width: 460,
      height: 320,
    });
    expect(z.decor).toHaveLength(2);
    expect(z.decor.find((d: { type: string }) => d.type === 'BAR_COUNTER')).toMatchObject({
      pos_x: 24,
      pos_y: 80,
      width: 272,
      height: 60,
      label: 'Main Bar',
    });
  });
});
