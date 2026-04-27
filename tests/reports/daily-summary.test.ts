import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';
import { getTestApp } from '../helpers/app.js';
import { authHeader } from '../helpers/auth.js';
import { makeUser } from '../helpers/factories.js';

const app = getTestApp();

const TODAY_ISO = '2026-04-27';
const TODAY_UTC = new Date(Date.UTC(2026, 3, 27));
const YESTERDAY_UTC = new Date(Date.UTC(2026, 3, 26));

interface Seed {
  userId: string;
  auth: Record<string, string>;
  registerId: string;
}

async function seed(): Promise<Seed> {
  const user = await makeUser();
  const register = await prisma.cashRegister.create({
    data: {
      user_id: user.id,
      opening_amount: 50000,
      expected_amount: 50000,
      status: 'OPEN',
      opened_at: TODAY_UTC,
    },
  });
  return { userId: user.id, auth: authHeader(user.id), registerId: register.id };
}

interface OrderSeedInput {
  registerId: string;
  userId: string;
  orderNumber: number;
  orderDate: Date;
  status?: 'PAID' | 'OPEN' | 'CANCELLED';
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payments: { method: 'CASH' | 'CARD' | 'TRANSFER'; amount: number; change?: number }[];
}

async function seedOrder(input: OrderSeedInput): Promise<string> {
  const order = await prisma.order.create({
    data: {
      register_id: input.registerId,
      user_id: input.userId,
      order_number: input.orderNumber,
      order_date: input.orderDate,
      order_type: 'DINE_IN',
      status: input.status ?? 'PAID',
      subtotal: input.subtotal,
      tax_amount: input.tax,
      discount_amount: input.discount,
      total: input.total,
      payments: {
        create: input.payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          change_amount: p.change ?? 0,
        })),
      },
    },
  });
  return order.id;
}

describe('GET /api/v1/reports/daily-summary', () => {
  let s: Seed;
  beforeEach(async () => {
    s = await seed();
  });

  it('returns zeroed totals when there is no activity for the day', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/daily-summary?date=${TODAY_ISO}`)
      .set(s.auth)
      .expect(200);

    expect(res.body.data.date).toBe(TODAY_ISO);
    expect(res.body.data.register_id).toBeNull();
    expect(res.body.data.orders.count).toBe(0);
    expect(res.body.data.orders.gross_revenue).toBe('0');
    expect(res.body.data.orders.avg_ticket).toBe('0');
    expect(res.body.data.payment_methods).toEqual([]);
    expect(res.body.data.cash_movements.cash_in_total).toBe('0');
    expect(res.body.data.cash_movements.cash_out_total).toBe('0');
    expect(res.body.data.cash_movements.items).toEqual([]);
    expect(res.body.data.expected_cash).toBeNull();
  });

  it('aggregates PAID orders, payment methods, cash movements, and excludes other days', async () => {
    // Two orders today — one CASH-only, one split CASH+CARD.
    await seedOrder({
      registerId: s.registerId,
      userId: s.userId,
      orderNumber: 1,
      orderDate: TODAY_UTC,
      subtotal: 10000,
      tax: 1600,
      discount: 0,
      total: 11600,
      payments: [{ method: 'CASH', amount: 12000, change: 400 }],
    });
    await seedOrder({
      registerId: s.registerId,
      userId: s.userId,
      orderNumber: 2,
      orderDate: TODAY_UTC,
      subtotal: 20000,
      tax: 3200,
      discount: 1200,
      total: 22000,
      payments: [
        { method: 'CASH', amount: 10000 },
        { method: 'CARD', amount: 12000 },
      ],
    });
    // OPEN order today — must not appear in totals.
    await seedOrder({
      registerId: s.registerId,
      userId: s.userId,
      orderNumber: 3,
      orderDate: TODAY_UTC,
      status: 'OPEN',
      subtotal: 5000,
      tax: 800,
      discount: 0,
      total: 5800,
      payments: [],
    });
    // PAID order yesterday — must not appear.
    await seedOrder({
      registerId: s.registerId,
      userId: s.userId,
      orderNumber: 99,
      orderDate: YESTERDAY_UTC,
      subtotal: 99999,
      tax: 0,
      discount: 0,
      total: 99999,
      payments: [{ method: 'CASH', amount: 99999 }],
    });

    // Cash movements: one IN, one OUT today; one yesterday (excluded).
    await prisma.cashMovement.create({
      data: {
        register_id: s.registerId,
        user_id: s.userId,
        type: 'CASH_IN',
        amount: 5000,
        reason: 'Tip jar deposit',
        created_at: new Date('2026-04-27T10:00:00Z'),
      },
    });
    await prisma.cashMovement.create({
      data: {
        register_id: s.registerId,
        user_id: s.userId,
        type: 'CASH_OUT',
        amount: 2000,
        reason: 'Bought paper towels',
        created_at: new Date('2026-04-27T11:00:00Z'),
      },
    });
    await prisma.cashMovement.create({
      data: {
        register_id: s.registerId,
        user_id: s.userId,
        type: 'CASH_IN',
        amount: 999,
        reason: 'Yesterday',
        created_at: new Date('2026-04-26T11:00:00Z'),
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/daily-summary?date=${TODAY_ISO}`)
      .set(s.auth)
      .expect(200);

    const d = res.body.data;
    expect(d.orders.count).toBe(2);
    expect(d.orders.gross_revenue).toBe('33600'); // 11600 + 22000
    expect(d.orders.net_revenue).toBe('30000'); // 10000 + 20000
    expect(d.orders.tax_total).toBe('4800');
    expect(d.orders.discount_total).toBe('1200');
    expect(d.orders.avg_ticket).toBe('16800');

    const cash = d.payment_methods.find((m: { method: string }) => m.method === 'CASH');
    const card = d.payment_methods.find((m: { method: string }) => m.method === 'CARD');
    expect(cash).toEqual({ method: 'CASH', count: 2, total: '22000' });
    expect(card).toEqual({ method: 'CARD', count: 1, total: '12000' });

    expect(d.cash_movements.cash_in_total).toBe('5000');
    expect(d.cash_movements.cash_out_total).toBe('2000');
    expect(d.cash_movements.items).toHaveLength(2);
  });

  it('scopes to a single register and computes expected_cash from primary tables', async () => {
    // Today: register A has one paid order, register B has one paid order.
    const userB = await makeUser();
    const registerB = await prisma.cashRegister.create({
      data: {
        user_id: userB.id,
        opening_amount: 30000,
        expected_amount: 30000,
        status: 'OPEN',
        opened_at: TODAY_UTC,
      },
    });

    await seedOrder({
      registerId: s.registerId,
      userId: s.userId,
      orderNumber: 1,
      orderDate: TODAY_UTC,
      subtotal: 5000,
      tax: 0,
      discount: 0,
      total: 5000,
      payments: [{ method: 'CASH', amount: 6000, change: 1000 }],
    });
    await seedOrder({
      registerId: registerB.id,
      userId: userB.id,
      orderNumber: 2,
      orderDate: TODAY_UTC,
      subtotal: 8000,
      tax: 0,
      discount: 0,
      total: 8000,
      payments: [{ method: 'CARD', amount: 8000 }],
    });

    await prisma.cashMovement.create({
      data: {
        register_id: s.registerId,
        user_id: s.userId,
        type: 'CASH_IN',
        amount: 1500,
        reason: 'Float top-up',
        created_at: new Date('2026-04-27T09:00:00Z'),
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/daily-summary?date=${TODAY_ISO}&register_id=${s.registerId}`)
      .set(s.auth)
      .expect(200);

    const d = res.body.data;
    expect(d.register_id).toBe(s.registerId);
    expect(d.orders.count).toBe(1);
    expect(d.orders.gross_revenue).toBe('5000');
    // expected_cash = opening (50000) + cash payments (6000) − change (1000) + cash_in (1500) − cash_out (0) = 56500
    expect(d.expected_cash).toBe('56500');
  });

  it('returns 404 when register_id does not exist', async () => {
    await request(app)
      .get(
        `/api/v1/reports/daily-summary?date=${TODAY_ISO}&register_id=00000000-0000-0000-0000-000000000000`,
      )
      .set(s.auth)
      .expect(404);
  });

  it('rejects malformed date with 422', async () => {
    await request(app)
      .get('/api/v1/reports/daily-summary?date=2026-13-99')
      .set(s.auth)
      .expect(422);
    await request(app)
      .get('/api/v1/reports/daily-summary?date=not-a-date')
      .set(s.auth)
      .expect(422);
  });
});
