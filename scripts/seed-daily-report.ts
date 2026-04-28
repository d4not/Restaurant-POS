/**
 * Sembra un DailyReport sintético con dos shifts (regular + provisional sin
 * verificar) para tener algo en /reports/daily del admin. Anclado a AYER UTC
 * para evitar chocar con la única fila por día (date) y para no tocar el
 * shift abierto de hoy. Idempotente: si ya hay un DailyReport para ayer, lo
 * imprime y sale sin escribir nada nuevo.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

function midnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const today = midnightUtc(new Date());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const existing = await prisma.dailyReport.findUnique({ where: { date: yesterday } });
  if (existing) {
    console.log('Daily report already exists for', yesterday.toISOString().slice(0, 10));
    console.log('  id:', existing.id, 'folio:', existing.folio, 'status:', existing.status);
    await prisma.$disconnect();
    return;
  }

  // Reusable people from the seed.
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: 'ADMIN', active: true },
    select: { id: true, name: true, role: true },
  });
  const cashier = await prisma.user.findFirstOrThrow({
    where: { role: 'CASHIER', active: true },
    select: { id: true, name: true, role: true },
  });
  const waiter = await prisma.user.findFirstOrThrow({
    where: { role: 'WAITER', active: true },
    select: { id: true, name: true, role: true },
  });

  // Shift A — regular cashier shift, full day. Opened 09:00 UTC, closed 17:00 UTC
  // yesterday. Counts come out short by 3000 centavos → CASH_SHORTAGE (HIGH).
  // Shift B — provisional opened by the waiter at 14:00 UTC, closed 18:00 UTC,
  // never verified → UNVERIFIED_PROVISIONAL (CRITICAL) at day close.
  const shiftAOpenedAt = new Date(yesterday.getTime() + 9 * 60 * 60 * 1000);
  const shiftAClosedAt = new Date(yesterday.getTime() + 17 * 60 * 60 * 1000);
  const shiftBOpenedAt = new Date(yesterday.getTime() + 14 * 60 * 60 * 1000);
  const shiftBClosedAt = new Date(yesterday.getTime() + 18 * 60 * 60 * 1000);

  // Realistic numbers (centavos). 60 paid tickets across both shifts.
  const aGross = 142_500; // $1,425.00
  const aDiscounts = 7_500;
  const aNet = aGross - aDiscounts;
  const aTax = 19_655;
  const aTickets = 47;
  const aCash = 88_500;
  const aCard = 39_000;
  const aTransfer = 15_000;
  const aOpening = 50_000;
  const aCashIn = 5_000;
  const aCashOut = 2_500;
  const aExpected = aOpening + aCash + aCashIn - aCashOut; // 141_000
  const aActual = aExpected - 3_000; // shortage
  const aVariance = aActual - aExpected; // -3000

  const bGross = 28_000; // provisional handled the busy 2-hour pull
  const bDiscounts = 0;
  const bNet = bGross;
  const bTax = 3_864;
  const bTickets = 13;
  const bCash = 18_000;
  const bCard = 10_000;
  const bTransfer = 0;
  const bOpening = 0;
  const bCashIn = 0;
  const bCashOut = 0;
  const bExpected = bOpening + bCash + bCashIn - bCashOut; // 18_000
  const bActual = bExpected; // counted exactly
  const bVariance = 0;

  // Per-category and per-product rollups for the printable detail page.
  const salesByCategoryA = [
    { category_id: 'cat-hot-coffee', category_name: 'Hot Coffee', item_count: 28, total: 84_000 },
    { category_id: 'cat-cold-coffee', category_name: 'Cold Coffee', item_count: 11, total: 38_500 },
    { category_id: 'cat-bottled', category_name: 'Bottled Drinks', item_count: 8, total: 20_000 },
  ];
  const salesByCategoryB = [
    { category_id: 'cat-hot-coffee', category_name: 'Hot Coffee', item_count: 6, total: 18_000 },
    { category_id: 'cat-bottled', category_name: 'Bottled Drinks', item_count: 4, total: 10_000 },
  ];
  const topProductsA = [
    { product_id: 'prod-latte', product_name: 'Latte', quantity: 14, total: 56_000 },
    { product_id: 'prod-capp', product_name: 'Cappuccino', quantity: 9, total: 36_000 },
    { product_id: 'prod-water', product_name: 'Bottled Water', quantity: 8, total: 20_000 },
    { product_id: 'prod-am', product_name: 'Americano', quantity: 5, total: 17_500 },
    { product_id: 'prod-mocha', product_name: 'Mocha', quantity: 5, total: 21_000 },
  ];
  const topProductsB = [
    { product_id: 'prod-latte', product_name: 'Latte', quantity: 4, total: 16_000 },
    { product_id: 'prod-water', product_name: 'Bottled Water', quantity: 4, total: 10_000 },
    { product_id: 'prod-am', product_name: 'Americano', quantity: 2, total: 7_000 },
  ];

  // Single-transaction insert so a partial failure doesn't leave an orphan
  // DailyReport without its shifts.
  const result = await prisma.$transaction(async (tx) => {
    // Two CashRegisters — one regular (A), one provisional (B). We don't
    // create any orders/payments because the ShiftReport is the immutable
    // snapshot — the admin page reads from it, not from the underlying
    // transactional tables.
    const regA = await tx.cashRegister.create({
      data: {
        user_id: cashier.id,
        kind: 'NORMAL',
        type: 'REGULAR',
        status: 'CLOSED',
        opening_amount: new Prisma.Decimal(aOpening),
        expected_amount: new Prisma.Decimal(aExpected),
        actual_amount: new Prisma.Decimal(aActual),
        difference: new Prisma.Decimal(aVariance),
        opened_at: shiftAOpenedAt,
        closed_at: shiftAClosedAt,
        closed_by_user_id: cashier.id,
        notes: 'Sample data — full-day cashier shift',
      },
    });
    const regB = await tx.cashRegister.create({
      data: {
        user_id: waiter.id,
        kind: 'PROVISIONAL',
        type: 'PROVISIONAL',
        status: 'CLOSED',
        parent_shift_id: regA.id,
        requires_verification: true,
        opening_amount: new Prisma.Decimal(bOpening),
        expected_amount: new Prisma.Decimal(bExpected),
        actual_amount: new Prisma.Decimal(bActual),
        difference: new Prisma.Decimal(bVariance),
        opened_at: shiftBOpenedAt,
        closed_at: shiftBClosedAt,
        closed_by_user_id: cashier.id,
        notes: 'Sample data — provisional run while cashier was on a delivery',
      },
    });

    // Immutable ShiftReports — denormalised so user/role rotation can't
    // rewrite history.
    const reportA = await tx.shiftReport.create({
      data: {
        cash_register_id: regA.id,
        user_id: cashier.id,
        user_name: cashier.name,
        user_role: cashier.role,
        shift_type: 'REGULAR',
        opened_at: shiftAOpenedAt,
        closed_at: shiftAClosedAt,
        gross_sales: aGross,
        discounts: aDiscounts,
        comps: 0,
        void_total: 4_500,
        void_count: 4,
        net_sales: aNet,
        tax_collected: aTax,
        total_tickets: aTickets,
        avg_ticket: Math.round(aGross / aTickets),
        cash_sales: aCash,
        card_sales: aCard,
        transfer_sales: aTransfer,
        other_sales: 0,
        opening_amount: aOpening,
        cash_in: aCashIn,
        cash_out: aCashOut,
        expected_cash: aExpected,
        actual_cash: aActual,
        cash_variance: aVariance,
        sales_by_category: salesByCategoryA as unknown as Prisma.InputJsonValue,
        top_products: topProductsA as unknown as Prisma.InputJsonValue,
      },
    });
    const reportB = await tx.shiftReport.create({
      data: {
        cash_register_id: regB.id,
        user_id: waiter.id,
        user_name: waiter.name,
        user_role: waiter.role,
        shift_type: 'PROVISIONAL',
        opened_at: shiftBOpenedAt,
        closed_at: shiftBClosedAt,
        gross_sales: bGross,
        discounts: bDiscounts,
        comps: 0,
        void_total: 0,
        void_count: 0,
        net_sales: bNet,
        tax_collected: bTax,
        total_tickets: bTickets,
        avg_ticket: Math.round(bGross / bTickets),
        cash_sales: bCash,
        card_sales: bCard,
        transfer_sales: bTransfer,
        other_sales: 0,
        opening_amount: bOpening,
        cash_in: bCashIn,
        cash_out: bCashOut,
        expected_cash: bExpected,
        actual_cash: bActual,
        cash_variance: bVariance,
        sales_by_category: salesByCategoryB as unknown as Prisma.InputJsonValue,
        top_products: topProductsB as unknown as Prisma.InputJsonValue,
      },
    });

    // Day-level aggregates: sum of the two shifts plus a merged JSON view
    // and the hourly buckets.
    const gross = aGross + bGross;
    const discounts = aDiscounts + bDiscounts;
    const tickets = aTickets + bTickets;
    const salesByHour = [
      { hour: 9,  tickets: 5,  total: 14_500 },
      { hour: 10, tickets: 8,  total: 27_000 },
      { hour: 11, tickets: 6,  total: 19_000 },
      { hour: 12, tickets: 9,  total: 31_000 },
      { hour: 13, tickets: 12, total: 38_500 },
      { hour: 14, tickets: 7,  total: 22_000 },
      { hour: 15, tickets: 6,  total: 14_500 },
      { hour: 16, tickets: 4,  total: 4_000 },
    ];
    const peakHour = salesByHour.reduce((p, h) => (h.total > p.total ? h : p), salesByHour[0]!).hour;
    const slowHour = salesByHour.reduce((p, h) => (h.total < p.total ? h : p), salesByHour[0]!).hour;
    const mergedCategories = [
      { category_id: 'cat-hot-coffee', category_name: 'Hot Coffee', item_count: 34, total: 102_000 },
      { category_id: 'cat-cold-coffee', category_name: 'Cold Coffee', item_count: 11, total: 38_500 },
      { category_id: 'cat-bottled', category_name: 'Bottled Drinks', item_count: 12, total: 30_000 },
    ];
    const mergedTop = [
      { product_id: 'prod-latte', product_name: 'Latte', quantity: 18, total: 72_000 },
      { product_id: 'prod-capp', product_name: 'Cappuccino', quantity: 9, total: 36_000 },
      { product_id: 'prod-water', product_name: 'Bottled Water', quantity: 12, total: 30_000 },
      { product_id: 'prod-mocha', product_name: 'Mocha', quantity: 5, total: 21_000 },
      { product_id: 'prod-am', product_name: 'Americano', quantity: 7, total: 24_500 },
    ];
    const bottomFive = [
      { product_id: 'prod-am', product_name: 'Americano', quantity: 7, total: 24_500 },
      { product_id: 'prod-mocha', product_name: 'Mocha', quantity: 5, total: 21_000 },
      { product_id: 'prod-capp', product_name: 'Cappuccino', quantity: 9, total: 36_000 },
      { product_id: 'prod-water', product_name: 'Bottled Water', quantity: 12, total: 30_000 },
      { product_id: 'prod-latte', product_name: 'Latte', quantity: 18, total: 72_000 },
    ];

    const dailyReport = await tx.dailyReport.create({
      data: {
        date: yesterday,
        status: 'CLOSED',
        gross_sales: gross,
        discounts,
        comps: 0,
        void_total: 4_500,
        void_count: 4,
        net_sales: gross - discounts,
        tax_collected: aTax + bTax,
        total_tickets: tickets,
        avg_ticket: Math.round(gross / tickets),
        cash_sales: aCash + bCash,
        card_sales: aCard + bCard,
        transfer_sales: aTransfer + bTransfer,
        other_sales: 0,
        total_opening_amount: aOpening + bOpening,
        total_cash_in: aCashIn + bCashIn,
        total_cash_out: aCashOut + bCashOut,
        total_expected_cash: aExpected + bExpected,
        total_actual_cash: aActual + bActual,
        total_cash_variance: aVariance + bVariance,
        sales_by_category: mergedCategories as unknown as Prisma.InputJsonValue,
        top_products: mergedTop as unknown as Prisma.InputJsonValue,
        bottom_products: bottomFive as unknown as Prisma.InputJsonValue,
        sales_by_hour: salesByHour as unknown as Prisma.InputJsonValue,
        total_shifts: 2,
        provisional_shifts: 1,
        unverified_provisionals: 1,
        peak_hour: peakHour,
        slowest_hour: slowHour,
        closed_by_id: admin.id,
        closed_at: new Date(yesterday.getTime() + 19 * 60 * 60 * 1000),
        notes: 'Sample manager note — busy lunch rush, provisional opened during a delivery run.',
      },
    });

    // Link the contributing shifts back to the day so the detail page can
    // hydrate them via the relation.
    await tx.cashRegister.updateMany({
      where: { id: { in: [regA.id, regB.id] } },
      data: { daily_report_id: dailyReport.id },
    });

    // Alerts — one shift-level CASH_SHORTAGE on shift A, one shift-level
    // EXCESSIVE_VOIDS on shift A (4 voids > default cap of 3), one
    // day-level UNVERIFIED_PROVISIONAL pointing at shift B. Mix of
    // resolved/open so the table actually has variety.
    await tx.alert.createMany({
      data: [
        {
          type: 'CASH_SHORTAGE',
          severity: 'HIGH',
          message: `Cash shortage of $30.00 in ${cashier.name}'s shift`,
          data: { variance: aVariance, threshold: 2000 } as Prisma.InputJsonValue,
          user_id: cashier.id,
          shift_report_id: reportA.id,
        },
        {
          type: 'EXCESSIVE_VOIDS',
          severity: 'HIGH',
          message: `4 voided orders in ${cashier.name}'s shift (limit: 3)`,
          data: { void_count: 4, threshold: 3 } as Prisma.InputJsonValue,
          user_id: cashier.id,
          shift_report_id: reportA.id,
          // Already cleared so the queue shows a resolved row alongside the
          // open ones — manager already counted again and reconciled.
          resolved: true,
          resolved_by_id: admin.id,
          resolved_at: new Date(yesterday.getTime() + 20 * 60 * 60 * 1000),
          resolution: 'Reviewed; voids were legitimate kitchen issues',
        },
        {
          type: 'UNVERIFIED_PROVISIONAL',
          severity: 'CRITICAL',
          message: `Provisional shift opened by ${waiter.name} closed without manager verification`,
          data: { shift_id: regB.id, opener_user_id: waiter.id } as Prisma.InputJsonValue,
          user_id: waiter.id,
          daily_report_id: dailyReport.id,
        },
      ],
    });

    return { dailyReport, regA, regB, reportA, reportB };
  });

  console.log('Seeded daily report:');
  console.log('  id:', result.dailyReport.id);
  console.log('  folio:', result.dailyReport.folio);
  console.log('  date:', result.dailyReport.date.toISOString().slice(0, 10));
  console.log('  status:', result.dailyReport.status);
  console.log('  shifts:', result.regA.id, '+', result.regB.id);
  console.log('Open the admin panel and navigate to /reports/daily to see it.');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
