import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';
import {
  closeShift,
  openShift,
  payCashOrder,
  seedLifecycle,
} from './_helpers.js';

const app = getTestApp();

// End-to-end DailyReport lifecycle: spin up two regular shifts in sequence,
// process payments on each, close the day, and verify the consolidated
// report's totals match the sum of its contributing ShiftReports. Folio is
// asserted against a fresh insert so its monotonic-increment property holds.
describe('DailyReport lifecycle — two shifts → close → consolidated report', () => {
  it('aggregates totals across two ShiftReports and links them to the day', async () => {
    const s = await seedLifecycle(app);
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    // Shift A: 2× espresso paid as 10000 cash exact, then 1× espresso paid as
    // 6000 cash (1000 change). Net cash = 15000. Drawer counted 65000.
    const regA = await openShift(app, s.cashier.auth, 50000);
    await payCashOrder(app, s.cashier.auth, regA, s.productId, 2, 10000);
    await payCashOrder(app, s.cashier.auth, regA, s.productId, 1, 6000);
    await closeShift(app, s.cashier.auth, regA, 65000);

    // Shift B: 3× espresso, 15000 cash exact. Drawer counted 75000 (60k
    // opening + 15k sales). Sequential — singleton shift model only allows
    // one OPEN at a time, so B starts after A closes.
    const regB = await openShift(app, s.cashier.auth, 60000);
    await payCashOrder(app, s.cashier.auth, regB, s.productId, 3, 15000);
    await closeShift(app, s.cashier.auth, regB, 75000);

    const close = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({ notes: 'EOD A+B' })
      .expect(200);

    const day = close.body.data;
    expect(day.status).toBe('CLOSED');
    expect(day.closed_by_id).toBe(admin.id);
    expect(day.notes).toBe('EOD A+B');
    expect(day.total_shifts).toBe(2);

    // Compare the consolidated row directly against the sum of underlying
    // ShiftReports. If aggregation drifts, this catches it.
    const reports = await prisma.shiftReport.findMany();
    expect(reports).toHaveLength(2);
    const sum = reports.reduce(
      (acc, r) => ({
        gross_sales: acc.gross_sales + r.gross_sales,
        net_sales: acc.net_sales + r.net_sales,
        cash_sales: acc.cash_sales + r.cash_sales,
        total_tickets: acc.total_tickets + r.total_tickets,
        tax_collected: acc.tax_collected + r.tax_collected,
        opening_amount: acc.opening_amount + r.opening_amount,
        expected_cash: acc.expected_cash + r.expected_cash,
        actual_cash: acc.actual_cash + (r.actual_cash ?? 0),
        cash_variance: acc.cash_variance + (r.cash_variance ?? 0),
      }),
      {
        gross_sales: 0,
        net_sales: 0,
        cash_sales: 0,
        total_tickets: 0,
        tax_collected: 0,
        opening_amount: 0,
        expected_cash: 0,
        actual_cash: 0,
        cash_variance: 0,
      },
    );
    expect(day.gross_sales).toBe(sum.gross_sales);
    expect(day.net_sales).toBe(sum.net_sales);
    expect(day.cash_sales).toBe(sum.cash_sales);
    expect(day.total_tickets).toBe(sum.total_tickets);
    expect(day.tax_collected).toBe(sum.tax_collected);
    expect(day.total_opening_amount).toBe(sum.opening_amount);
    expect(day.total_expected_cash).toBe(sum.expected_cash);
    expect(day.total_actual_cash).toBe(sum.actual_cash);
    expect(day.total_cash_variance).toBe(sum.cash_variance);

    // avg_ticket = gross / tickets, integer-rounded.
    expect(day.avg_ticket).toBe(Math.round(sum.gross_sales / sum.total_tickets));

    // Both contributing CashRegisters now carry the daily_report_id so the
    // shift-list page can show "Closed in day Z-XXXX".
    const linkedA = await prisma.cashRegister.findUniqueOrThrow({ where: { id: regA } });
    const linkedB = await prisma.cashRegister.findUniqueOrThrow({ where: { id: regB } });
    expect(linkedA.daily_report_id).toBe(day.id);
    expect(linkedB.daily_report_id).toBe(day.id);
  });

  it('folio increments monotonically across DailyReport inserts', async () => {
    const s = await seedLifecycle(app);
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    // Close today.
    const reg = await openShift(app, s.cashier.auth, 10000);
    await closeShift(app, s.cashier.auth, reg, 10000);
    const dayOne = (
      await request(app)
        .post('/api/v1/daily-reports/close')
        .set(adminAuth)
        .send({})
        .expect(200)
    ).body.data;
    expect(typeof dayOne.folio).toBe('number');
    expect(dayOne.folio).toBeGreaterThan(0);

    // The unique date constraint blocks a second close for the same UTC day.
    // To assert folio increments, we sneak a second DailyReport in for a
    // different date (yesterday) directly via Prisma — same path the
    // sequence would take in production once the day rolls over.
    const yesterday = new Date(dayOne.date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dayTwo = await prisma.dailyReport.create({
      data: { date: yesterday, status: 'CLOSED' },
    });
    expect(dayTwo.folio).toBeGreaterThan(dayOne.folio);
  });

  it('rejects a second close on the same day with 409', async () => {
    const s = await seedLifecycle(app);
    const admin = await makeUser({ role: 'ADMIN' });
    const adminAuth = authHeader(admin.id, 'ADMIN');

    const reg = await openShift(app, s.cashier.auth, 10000);
    await closeShift(app, s.cashier.auth, reg, 10000);

    await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({})
      .expect(200);

    // Second attempt — DailyReport.date is unique, the P2002 surfaces from
    // Prisma and the global error handler maps it to 409.
    const second = await request(app)
      .post('/api/v1/daily-reports/close')
      .set(adminAuth)
      .send({});
    expect(second.status).toBe(409);
  });
});
