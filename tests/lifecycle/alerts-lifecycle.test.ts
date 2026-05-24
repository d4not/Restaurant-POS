import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';
import {
  cancelOrder,
  closeShift,
  openOrderWithItem,
  openShift,
  payCashOrder,
  seedLifecycle,
} from './_helpers.js';

const app = getTestApp();

// Coverage of the alert-generation rules described in REPORTS-SPEC §4.3.
// Thresholds use the spec defaults baked into the service (2000 centavos for
// shortage/surplus, 3 voids per shift, 10% discount). Tests don't seed the
// settings table — the close path falls back to defaults.
describe('Alert generation — shift-level thresholds at close', () => {
  it('CASH_SHORTAGE: missing > 5000 centavos escalates to CRITICAL', async () => {
    const s = await seedLifecycle(app);
    const registerId = await openShift(app, s.cashier.auth, 50000);
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 5000);

    // Expected = 55000; counted 48000 → variance -7000. Above the 5000 bar
    // for CRITICAL.
    await closeShift(app, s.cashier.auth, registerId, 48000);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: registerId },
      include: { alerts: true },
    });
    expect(report.cash_variance).toBe(-7000);
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0]!.type).toBe('CASH_SHORTAGE');
    expect(report.alerts[0]!.severity).toBe('CRITICAL');
  });

  it('CASH_SURPLUS: extra cash above the surplus threshold lands a MEDIUM alert', async () => {
    const s = await seedLifecycle(app);
    const registerId = await openShift(app, s.cashier.auth, 50000);
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 5000);

    // Expected = 55000; counted 60000 → variance +5000 (over the 2000
    // surplus threshold).
    await closeShift(app, s.cashier.auth, registerId, 60000);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: registerId },
      include: { alerts: true },
    });
    expect(report.cash_variance).toBe(5000);
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0]!.type).toBe('CASH_SURPLUS');
    expect(report.alerts[0]!.severity).toBe('MEDIUM');
  });

  it('EXCESSIVE_VOIDS: more cancelled orders than the per-shift cap', async () => {
    const s = await seedLifecycle(app);
    const registerId = await openShift(app, s.cashier.auth, 50000);

    // One paid order so the shift has revenue (and the discount-percent rule
    // doesn't trip on a divide-by-zero).
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 5000);

    // Four cancelled orders — strictly more than the default cap of 3.
    for (let i = 0; i < 4; i++) {
      const orderId = await openOrderWithItem(
        app,
        s.cashier.auth,
        registerId,
        s.productId,
        1,
      );
      await cancelOrder(app, s.cashier.auth, orderId, `cancel #${i + 1}`);
    }

    // Counted exactly the expected so no cash alert noise.
    await closeShift(app, s.cashier.auth, registerId, 55000);

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: registerId },
      include: { alerts: true },
    });
    expect(report.void_count).toBe(4);
    const voidsAlert = report.alerts.find((a) => a.type === 'EXCESSIVE_VOIDS');
    expect(voidsAlert).toBeDefined();
    expect(voidsAlert!.severity).toBe('HIGH');
    expect(voidsAlert!.user_id).toBe(s.cashier.id);
  });

});

// Resolution flow — manager+ marks an alert resolved with a written note.
// Uses the alerts list endpoint to confirm the resolution shows up across the
// API surface, not just on the row directly.
describe('Alert resolution — PATCH /api/v1/alerts/:id/resolve', () => {
  it('resolves an open alert with audit fields populated and surfaces it in the list', async () => {
    const s = await seedLifecycle(app);
    const manager = await makeUser({ role: 'MANAGER' });
    const managerAuth = authHeader(manager.id, 'MANAGER');

    // Generate one CASH_SURPLUS alert via a clean shift with extra cash.
    const registerId = await openShift(app, s.cashier.auth, 50000);
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 5000);
    await closeShift(app, s.cashier.auth, registerId, 60000); // +5000 surplus

    const created = await prisma.alert.findFirstOrThrow({ where: { type: 'CASH_SURPLUS' } });
    expect(created.resolved).toBe(false);

    const res = await request(app)
      .patch(`/api/v1/alerts/${created.id}/resolve`)
      .set(managerAuth)
      .send({ resolution: 'Recounted; extra cash was a tip drop' })
      .expect(200);
    expect(res.body.data.resolved).toBe(true);
    expect(res.body.data.resolved_by_id).toBe(manager.id);
    expect(res.body.data.resolved_at).not.toBeNull();
    expect(res.body.data.resolution).toBe('Recounted; extra cash was a tip drop');

    // Re-resolving a resolved alert is a 409 — the audit fields are
    // write-once.
    const second = await request(app)
      .patch(`/api/v1/alerts/${created.id}/resolve`)
      .set(managerAuth)
      .send({ resolution: 'attempt #2' });
    expect(second.status).toBe(409);

    // Listing ?resolved=false now returns nothing (the only open alert was
    // just cleared); ?resolved=true returns the row we cleared.
    const openList = await request(app)
      .get('/api/v1/alerts?resolved=false')
      .set(managerAuth)
      .expect(200);
    expect(openList.body.data.items).toHaveLength(0);

    const closedList = await request(app)
      .get('/api/v1/alerts?resolved=true')
      .set(managerAuth)
      .expect(200);
    expect(closedList.body.data.items).toHaveLength(1);
    expect(closedList.body.data.items[0].id).toBe(created.id);
  });

  it('rejects WAITER from listing or resolving alerts (403)', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const list = await request(app).get('/api/v1/alerts').set(waiterAuth);
    expect(list.status).toBe(403);

    const resolve = await request(app)
      .patch('/api/v1/alerts/00000000-0000-0000-0000-000000000000/resolve')
      .set(waiterAuth)
      .send({ resolution: 'nope' });
    expect(resolve.status).toBe(403);
  });
});
