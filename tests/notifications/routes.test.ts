import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { SETTING_KEYS } from '../../src/modules/settings/schema.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';
import { inMemoryStore } from '../../src/modules/notifications/providers/in-app.js';

const app = getTestApp();

async function setEnabled(value: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.NOTIFICATIONS_ENABLED },
    create: { key: SETTING_KEYS.NOTIFICATIONS_ENABLED, value: String(value) },
    update: { value: String(value) },
  });
}

beforeEach(() => {
  inMemoryStore.clear();
});

describe('GET /api/v1/notifications', () => {
  it('returns empty list + 0 unread for a fresh user', async () => {
    const user = await makeUser({ role: 'MANAGER' });

    const res = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(user.id, 'MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.unread_count).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/notifications/test', () => {
  it('ADMIN can dispatch a synthetic event', async () => {
    await setEnabled(true);
    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START },
      create: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START, value: '00:00' },
      update: { value: '00:00' },
    });
    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END },
      create: { key: SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END, value: '00:00' },
      update: { value: '00:00' },
    });
    const admin = await makeUser({ role: 'ADMIN' });
    const manager = await makeUser({ role: 'MANAGER' });

    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set(authHeader(admin.id, 'ADMIN'))
      .send({ title: 'Hello manager', recipient_roles: ['MANAGER'] });

    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(true);

    // Wait a tick for the bus listener to resolve.
    await new Promise((r) => setTimeout(r, 30));

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(authHeader(manager.id, 'MANAGER'));
    expect(list.body.data.items[0]?.title).toBe('Hello manager');
  });

  it('CASHIER cannot hit /test (requires ADMIN)', async () => {
    const cashier = await makeUser({ role: 'CASHIER' });
    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set(authHeader(cashier.id, 'CASHIER'))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/notifications/:id/read', () => {
  it('marks a row as read and returns the updated row', async () => {
    await setEnabled(true);
    const admin = await makeUser({ role: 'ADMIN' });
    const stored = inMemoryStore.push(admin.id, {
      type: 'TEST',
      severity: 'INFO',
      title: 't',
      body: 'b',
    });

    const res = await request(app)
      .post(`/api/v1/notifications/${stored.id}/read`)
      .set(authHeader(admin.id, 'ADMIN'));

    expect(res.status).toBe(200);
    expect(res.body.data.read_at).not.toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const res = await request(app)
      .post('/api/v1/notifications/11111111-1111-1111-1111-111111111111/read')
      .set(authHeader(admin.id, 'ADMIN'));
    expect(res.status).toBe(404);
  });
});
