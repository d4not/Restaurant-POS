import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';
import {
  closeShift,
  openOrderWithItem,
  openShift,
  seedLifecycle,
} from './_helpers.js';

const app = getTestApp();

// End-to-end provisional flow: a regular cashier shift hosts a side-flow
// provisional opened by a waiter. The waiter pays an order against the
// provisional (no PIN required — provisional waives), the cashier closes
// it, a manager verifies it, and the immutable ShiftReport is then verified
// in the audit log. Restrictions (cash movements, discount, sent-item void)
// are exercised on the same setup.
describe('Provisional shift lifecycle — open → order → pay → close → verify', () => {
  it('opens against an OPEN regular shift, processes a payment, closes, and a manager PIN verifies it', async () => {
    const s = await seedLifecycle(app);

    // Manager carries a known PIN so the verify step can find them.
    const manager = await makeUser({ role: 'MANAGER', pin: '8421' });
    const managerAuth = authHeader(manager.id, 'MANAGER');
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    // Cashier's regular shift hosts the provisional. We don't process any
    // sales on the parent here — the goal is to keep the provisional
    // arithmetic tractable and isolated.
    const parentId = await openShift(app, s.cashier.auth, 50000);

    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parentId })
      .expect(201);
    const provisionalId = provisional.body.data.id as string;
    expect(provisional.body.data.type).toBe('PROVISIONAL');
    expect(provisional.body.data.opening_amount).toBe('0');
    expect(provisional.body.data.requires_verification).toBe(true);

    // Waiter takes one order on the provisional. Because the active register
    // is provisional, the payment path waives the cashier-PIN gate and
    // stamps the waiter as the implicit approver.
    const order = await request(app)
      .post('/api/v1/orders')
      .set(waiterAuth)
      .send({ register_id: provisionalId, order_type: 'DINE_IN' })
      .expect(201);
    await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/items`)
      .set(waiterAuth)
      .send({ product_id: s.productId, quantity: 1 })
      .expect(201);
    const pay = await request(app)
      .post(`/api/v1/orders/${order.body.data.id}/payments`)
      .set(waiterAuth)
      .send({ method: 'CASH', amount: 5000 })
      .expect(201);
    expect(pay.body.data.order.status).toBe('PAID');
    const storedPayment = await prisma.payment.findFirstOrThrow({
      where: { order_id: order.body.data.id },
    });
    expect(storedPayment.approved_by_user_id).toBe(waiter.id);

    // Cashier closes the provisional. Provisional opens at 0, so expected =
    // 0 (opening) + 5000 (cash sale) = 5000. Drawer counted 5000 — cuadra.
    const closed = (await closeShift(app, s.cashier.auth, provisionalId, 5000)) as {
      status: string;
      expected_amount: string;
      actual_amount: string;
      difference: string;
      verified_at: string | null;
    };
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_amount).toBe('5000');
    expect(closed.actual_amount).toBe('5000');
    expect(closed.difference).toBe('0');
    expect(closed.verified_at).toBeNull();

    // ShiftReport for the provisional is created at close. The opener (the
    // waiter) is the user_id, not the cashier who counted the cash.
    const report = await prisma.shiftReport.findUniqueOrThrow({
      where: { cash_register_id: provisionalId },
      include: { alerts: true },
    });
    expect(report.shift_type).toBe('PROVISIONAL');
    expect(report.user_id).toBe(waiter.id);
    expect(report.gross_sales).toBe(5000);
    expect(report.total_tickets).toBe(1);
    expect(report.cash_sales).toBe(5000);
    expect(report.cash_variance).toBe(0);

    // Manager verifies via PIN. Returns the updated CashRegister with
    // verified_by_id / verified_at populated.
    const verified = await request(app)
      .post(`/api/v1/registers/${provisionalId}/verify`)
      .set(managerAuth)
      .send({ pin: '8421', notes: 'Counted; cash matches' })
      .expect(200);
    expect(verified.body.data.verified_by_id).toBe(manager.id);
    expect(verified.body.data.verified_at).not.toBeNull();
    expect(verified.body.data.verification_notes).toBe('Counted; cash matches');

    // The CashRegister carries the verification audit; the linked ShiftReport
    // stays in its original (unverified) state because the snapshot is
    // immutable. That's the correct invariant — the verifier walks up after
    // the report has been issued.
    const fresh = await prisma.cashRegister.findUniqueOrThrow({
      where: { id: provisionalId },
    });
    expect(fresh.verified_by_id).toBe(manager.id);
    expect(fresh.verified_at).not.toBeNull();
  });
});

describe('Provisional shift restrictions — payment-only operating mode', () => {
  it('blocks cash movements, discounts, and sent-item cancels on a provisional shift', async () => {
    const s = await seedLifecycle(app);
    const waiter = await makeUser({ role: 'WAITER' });
    const waiterAuth = authHeader(waiter.id, 'WAITER');

    const parentId = await openShift(app, s.cashier.auth, 50000);
    const provisional = await request(app)
      .post('/api/v1/registers/provisional')
      .set(waiterAuth)
      .send({ parent_shift_id: parentId })
      .expect(201);
    const provisionalId = provisional.body.data.id as string;

    // 1) Cash movements — blocked outright (provisionals don't reconcile
    // their own drawer; the cashier handles that on the parent at close).
    const cashMovementRes = await request(app)
      .post(`/api/v1/registers/${provisionalId}/cash-movements`)
      .set(s.cashier.auth)
      .send({ type: 'CASH_IN', amount: 1000, reason: 'tips' });
    expect(cashMovementRes.status).toBe(403);
    expect(cashMovementRes.body.error.code).toBe('FORBIDDEN');
    expect(cashMovementRes.body.error.message).toMatch(/provisional/i);

    // 2) Discounts — blocked. Floor staff can take orders but can't cut
    // prices; that decision belongs on the cashier-driven parent shift.
    const order = await request(app)
      .post('/api/v1/orders')
      .set(waiterAuth)
      .send({ register_id: provisionalId, order_type: 'DINE_IN' })
      .expect(201);
    const discountRes = await request(app)
      .patch(`/api/v1/orders/${order.body.data.id}`)
      .set(s.cashier.auth)
      .send({ discount_amount: 1000, discount_reason: 'comp' });
    expect(discountRes.status).toBe(403);
    expect(discountRes.body.error.message).toMatch(/provisional/i);

    // 3) Cancel-with-sent-items — also blocked. Add an item, send to
    // kitchen, then a cancel attempt is forbidden. (Cancel-without-sent-
    // items is a no-friction path that floor staff can drive — that's
    // separately tested in tests/orders/.)
    const orderId = await openOrderWithItem(
      app,
      waiterAuth,
      provisionalId,
      s.productId,
      1,
    );
    await request(app)
      .post(`/api/v1/orders/${orderId}/send-to-kitchen`)
      .set(waiterAuth)
      .expect(200);
    const cancelRes = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set(s.cashier.auth)
      .send({ reason: 'kitchen out of stock' });
    expect(cancelRes.status).toBe(403);
    expect(cancelRes.body.error.message).toMatch(/provisional/i);
  });
});
