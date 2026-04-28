import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import {
  closeShift,
  openShift,
  payCashOrder,
  seedLifecycle,
} from './_helpers.js';

const app = getTestApp();

// End-to-end coverage of a regular shift's full lifecycle: open → orders →
// payments → close → ShiftReport snapshot → alert generation. The unit-style
// shift-report tests live in tests/shift-reports/; this file exercises the
// flow as the cashier actually drives it from the terminal.
describe('Shift lifecycle — open → orders → pay → close → report', () => {
  it('round-trips a cleanly-counted shift and produces a ShiftReport with no alerts', async () => {
    const s = await seedLifecycle(app);

    // Open with 50000 (= 500 pesos in centavos).
    const registerId = await openShift(app, s.cashier.auth, 50000);

    // Two orders: 2× 5000 paid as 10000 cash (no change), then 1× 5000 paid
    // as 6000 cash (1000 change).
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 2, 10000);
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 6000);

    // Drawer count = 50000 opening + 15000 net cash = 65000 — exactly cuadra.
    const closed = (await closeShift(app, s.cashier.auth, registerId, 65000)) as {
      status: string;
      expected_amount: string;
      actual_amount: string;
      difference: string;
    };
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_amount).toBe('65000');
    expect(closed.actual_amount).toBe('65000');
    expect(closed.difference).toBe('0');

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: registerId },
      include: { alerts: true },
    });
    expect(report.shift_type).toBe('REGULAR');
    expect(report.user_id).toBe(s.cashier.id);
    expect(report.gross_sales).toBe(15000);
    expect(report.net_sales).toBe(15000);
    expect(report.total_tickets).toBe(2);
    expect(report.cash_sales).toBe(15000);
    expect(report.expected_cash).toBe(65000);
    expect(report.actual_cash).toBe(65000);
    expect(report.cash_variance).toBe(0);
    expect(report.alerts).toHaveLength(0);
  });

  it('generates a CASH_SHORTAGE alert when the cashier counts short past the threshold', async () => {
    const s = await seedLifecycle(app);

    const registerId = await openShift(app, s.cashier.auth, 50000);

    // One sale at 5000 — opening + sale = 55000 expected.
    await payCashOrder(app, s.cashier.auth, registerId, s.productId, 1, 5000);

    // Cashier counts 52000 — short by 3000 centavos. Default shortage
    // threshold is 2000, so this trips the alert.
    const closed = (await closeShift(app, s.cashier.auth, registerId, 52000)) as {
      expected_amount: string;
      actual_amount: string;
      difference: string;
    };
    expect(closed.expected_amount).toBe('55000');
    expect(closed.actual_amount).toBe('52000');
    expect(closed.difference).toBe('-3000');

    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: registerId },
      include: { alerts: true },
    });
    expect(report.cash_variance).toBe(-3000);
    expect(report.alerts).toHaveLength(1);
    const alert = report.alerts[0]!;
    expect(alert.type).toBe('CASH_SHORTAGE');
    // |3000| is under the CRITICAL bar of 5000 centavos, so HIGH.
    expect(alert.severity).toBe('HIGH');
    expect(alert.user_id).toBe(s.cashier.id);
    expect(alert.shift_report_id).toBe(report.id);
    expect(alert.resolved).toBe(false);
    // The data payload carries the numbers behind the alert so a manager
    // viewing the queue doesn't have to cross-reference the report.
    const data = alert.data as { variance: number; threshold: number };
    expect(data.variance).toBe(-3000);
    expect(data.threshold).toBe(2000);
  });
});
