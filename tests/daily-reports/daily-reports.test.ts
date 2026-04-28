import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import {
  makeStorage,
  makeSupply,
  makeSupplyCategory,
  makeUser,
  seedStock,
} from '../helpers/factories.js';

const app = getTestApp();

interface RingSeed {
  cashier: { id: string; auth: Record<string, string> };
  productId: string;
}

// Per-test scaffold: a cashier, a stocked PRODUCT-typed item (PRODUCT avoids
// the recipe/ingredient dance — payment deducts 1 supply unit per line), and
// the deduction rule wiring so the sale resolves cleanly. The shift is opened
// on demand by openShift() rather than here so a single test can spin up
// multiple shifts on the same day.
async function seedRing(): Promise<RingSeed> {
  const user = await makeUser({ role: 'CASHIER' });
  const auth = authHeader(user.id, 'CASHIER');
  const storage = await makeStorage({ name: 'Bar' });
  const category = await makeSupplyCategory({ name: 'Drinks' });
  const supply = await makeSupply({
    category_id: category.id,
    name: 'Espresso shot',
    base_unit: 'PIECE',
  });
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
  // Default deduction rule with no register filter — applies to whichever shift
  // is open when the sale happens.
  await request(app)
    .post('/api/v1/deduction-rules')
    .set(auth)
    .send({ storage_id: storage.id })
    .expect(201);

  return {
    cashier: { id: user.id, auth },
    productId: product.body.data.id as string,
  };
}

async function openShift(
  auth: Record<string, string>,
  opening = 10000,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/registers')
    .set(auth)
    .send({ opening_amount: opening })
    .expect(201);
  return res.body.data.id as string;
}

async function payOrder(
  auth: Record<string, string>,
  registerId: string,
  productId: string,
  quantity: number,
  payAmount: number,
): Promise<void> {
  const order = await request(app)
    .post('/api/v1/orders')
    .set(auth)
    .send({ register_id: registerId, order_type: 'DINE_IN' })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${order.body.data.id}/items`)
    .set(auth)
    .send({ product_id: productId, quantity })
    .expect(201);
  await request(app)
    .post(`/api/v1/orders/${order.body.data.id}/payments`)
    .set(auth)
    .send({ method: 'CASH', amount: payAmount })
    .expect(201);
}

async function closeShift(
  auth: Record<string, string>,
  registerId: string,
  actualAmount: number,
): Promise<void> {
  await request(app)
    .post(`/api/v1/registers/${registerId}/close`)
    .set(auth)
    .send({ actual_amount: actualAmount })
    .expect(200);
}

describe('POST /api/v1/daily-reports/close', () => {
  it('closes the day with all shifts closed and creates a CLOSED DailyReport', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const reg = await openShift(s.cashier.auth, 50000);
    await payOrder(s.cashier.auth, reg, s.productId, 1, 5000);
    await closeShift(s.cashier.auth, reg, 55000);

    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({ notes: 'EOD' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.closed_by_id).toBe(admin.id);
    expect(res.body.data.closed_at).not.toBeNull();
    expect(res.body.data.notes).toBe('EOD');
    expect(typeof res.body.data.folio).toBe('number');
    expect(res.body.data.folio).toBeGreaterThan(0);
    expect(res.body.data.total_shifts).toBe(1);
  });

  it('rejects with 409 when any shift for today is still OPEN', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    await openShift(s.cashier.auth, 10000); // left OPEN

    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('1');
  });

  it('rejects with 400 when no shifts closed today', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('aggregates totals across multiple ShiftReports', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    // Two sequential shifts. First does 2x 5000 in cash, second does 1x 5000.
    const reg1 = await openShift(s.cashier.auth, 50000);
    await payOrder(s.cashier.auth, reg1, s.productId, 2, 10000);
    await closeShift(s.cashier.auth, reg1, 60000);

    const reg2 = await openShift(s.cashier.auth, 60000);
    await payOrder(s.cashier.auth, reg2, s.productId, 1, 5000);
    await closeShift(s.cashier.auth, reg2, 65000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);
    const body = close.body.data;

    // Sum = sum of ShiftReport columns. Verify directly against the source.
    const reports = await prisma.shiftReport.findMany({});
    const sumGross = reports.reduce((a, r) => a + r.gross_sales, 0);
    const sumCash = reports.reduce((a, r) => a + r.cash_sales, 0);
    const sumTickets = reports.reduce((a, r) => a + r.total_tickets, 0);
    expect(body.gross_sales).toBe(sumGross);
    expect(body.cash_sales).toBe(sumCash);
    expect(body.total_tickets).toBe(sumTickets);
    expect(body.total_shifts).toBe(2);
    // 15000 gross / 2 tickets = 7500.
    expect(body.avg_ticket).toBe(7500);
  });

  it('links every contributing shift to the new DailyReport', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const reg = await openShift(s.cashier.auth, 10000);
    await closeShift(s.cashier.auth, reg, 10000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    const updated = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: reg },
      select: { daily_report_id: true },
    });
    expect(updated.daily_report_id).toBe(close.body.data.id);
  });

  it('generates a CRITICAL UNVERIFIED_PROVISIONAL alert per unverified shift', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    // Cashier opens a regular shift, waiter opens a provisional against it.
    // Cashier closes the provisional but never verifies — should trigger
    // exactly one CRITICAL alert.
    const parent = await openShift(s.cashier.auth, 50000);
    const prov = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent })
      .expect(201);
    await closeShift(s.cashier.auth, prov.body.data.id, 0);
    await closeShift(s.cashier.auth, parent, 50000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    expect(close.body.data.unverified_provisionals).toBe(1);
    expect(close.body.data.provisional_shifts).toBe(1);

    const alerts = await prisma.alert.findMany({
      where: { daily_report_id: close.body.data.id },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe('UNVERIFIED_PROVISIONAL');
    expect(alerts[0]!.severity).toBe('CRITICAL');
    expect(alerts[0]!.user_id).toBe(waiter.id);
  });

  it('skips alerting when the provisional shift was verified', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN', pin: '4242' });
    const adminAuth = authHeader(admin.id, 'ADMIN');
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await openShift(s.cashier.auth, 50000);
    const prov = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent })
      .expect(201);
    await closeShift(s.cashier.auth, prov.body.data.id, 0);
    // Manager+ verifies via PIN step-up.
    await request(app)
      .post(`/api/v1/registers/${prov.body.data.id}/verify`)
      .set(adminAuth)
      .send({ pin: '4242' })
      .expect(200);
    await closeShift(s.cashier.auth, parent, 50000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);
    expect(close.body.data.unverified_provisionals).toBe(0);
    const alerts = await prisma.alert.findMany({
      where: { daily_report_id: close.body.data.id },
    });
    expect(alerts).toHaveLength(0);
  });

  it('rejects a second close on the same day with 409', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const reg = await openShift(s.cashier.auth, 10000);
    await closeShift(s.cashier.auth, reg, 10000);

    await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    // Second attempt — the unique date constraint flips a P2002 inside the
    // transaction and the global error handler maps it to 409.
    const second = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(second.status).toBe(409);
  });

  it('rejects WAITER with 403', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const res = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(authHeader(waiter.id, 'WAITER'))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/daily-reports/:id', () => {
  it('returns the report with nested shift_reports and alerts', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parent = await openShift(s.cashier.auth, 50000);
    await payOrder(s.cashier.auth, parent, s.productId, 1, 5000);
    const prov = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parent })
      .expect(201);
    await closeShift(s.cashier.auth, prov.body.data.id, 0);
    await closeShift(s.cashier.auth, parent, 55000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    const detail = await request(app)
      .get(`/api/v1/daily-reports/${close.body.data.id}`)
      .set(adminAuth)
      .expect(200);

    // Two shifts contributed: the provisional + the parent.
    expect(detail.body.data.shifts).toHaveLength(2);
    // Each shift carries its own ShiftReport (1:1) under the nested include.
    for (const shift of detail.body.data.shifts) {
      expect(shift.shift_report).not.toBeNull();
      expect(Array.isArray(shift.shift_report.alerts)).toBe(true);
    }
    // Alerts attached at the day level (UNVERIFIED_PROVISIONAL).
    expect(Array.isArray(detail.body.data.alerts)).toBe(true);
    expect(detail.body.data.alerts.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown id', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const res = await request(app)
      .get('/api/v1/daily-reports/00000000-0000-0000-0000-000000000000')
      .set(authHeader(admin.id, 'ADMIN'));
    expect(res.status).toBe(404);
  });

  it('rejects WAITER with 403', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const res = await request(app)
      .get('/api/v1/daily-reports/00000000-0000-0000-0000-000000000000')
      .set(authHeader(waiter.id, 'WAITER'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/daily-reports/:id/print', () => {
  it('returns text/html with the major report sections', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const parent = await openShift(s.cashier.auth, 50000);
    await payOrder(s.cashier.auth, parent, s.productId, 1, 5000);
    await closeShift(s.cashier.auth, parent, 55000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({ notes: 'Manager note for QA' })
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/daily-reports/${close.body.data.id}/print`)
      .set(adminAuth)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.text;
    expect(html).toMatch(/<!doctype html>/i);
    // Section headers from REPORTS-SPEC §5.2 (verification-checklist layout).
    // Default test seed has language='en' so we assert the English variants.
    expect(html).toMatch(/Cash in drawer/);
    expect(html).toMatch(/>Sales</);
    expect(html).toMatch(/Payment methods/);
    expect(html).toMatch(/Shifts/);
    expect(html).toMatch(/Products/);
    expect(html).toMatch(/Top products/);
    expect(html).toMatch(/Categories/);
    // Verification section is always printed — it carries the manager
    // resolution + blank signature lines that parents fill in by hand.
    expect(html).toMatch(/Verification/);
    expect(html).toMatch(/Verified by/);
    expect(html).toMatch(/Signature/);
    expect(html).toMatch(/sig-line/);
    // Manager note appears under the Verification block as "Notes:".
    expect(html).toMatch(/Notes:/);
    expect(html).toMatch(/Manager note for QA/);
    // Bottom-products and hourly-breakdown sections must NOT appear in the
    // new layout — both were dropped in §5.2.
    expect(html).not.toMatch(/Bottom 5/);
    expect(html).not.toMatch(/Hourly/);
    // Checklist checkboxes — rendered as literal "[ ]" text so a pen marks
    // them on paper, not as <input> elements.
    expect(html).toContain('[ ]');
    // Folio is rendered with a Z- prefix, zero-padded to 4 digits.
    expect(html).toMatch(/Z-\d{4}/);
    // Print button + window.print() wiring.
    expect(html).toMatch(/window\.print\(\)/);
    // @media print rule must hide the toolbar and force B&W output.
    expect(html).toMatch(/@media print/);
    // Empty <title> avoids leaking "Daily Report Z-…" into the printed
    // page header (browser-print behaviour).
    expect(html).toMatch(/<title><\/title>/);
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await request(app).get(
      '/api/v1/daily-reports/00000000-0000-0000-0000-000000000000/print',
    );
    expect(res.status).toBe(401);
  });

  it('rejects WAITER with 403', async () => {
    const waiter = await makeUser({ role: 'WAITER' });
    const res = await request(app)
      .get('/api/v1/daily-reports/00000000-0000-0000-0000-000000000000/print')
      .set(authHeader(waiter.id, 'WAITER'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/daily-reports', () => {
  it('returns paginated reports to MANAGER/ADMIN', async () => {
    const s = await seedRing();
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const reg = await openShift(s.cashier.auth, 10000);
    await closeShift(s.cashier.auth, reg, 10000);
    await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    const list = await request(app)
      .get('/api/v1/daily-reports')
      .set(adminAuth)
      .expect(200);
    expect(list.body.success).toBe(true);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.nextCursor).toBeNull();
  });
});
