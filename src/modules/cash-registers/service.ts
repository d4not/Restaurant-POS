import {
  CashMovementType,
  CashRegisterStatus,
  DailyReportStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { logger } from '../../lib/logger.js';
import { generateShiftReport } from '../shift-reports/service.js';
import { notificationBus } from '../notifications/event-bus.js';
import { getSetting } from '../settings/service.js';
import { SETTING_KEYS, CASH_HANDLING_DEFAULTS } from '../settings/schema.js';
import type {
  CloseRegisterInput,
  CreateCashMovementInput,
  ListCashMovementQuery,
  ListRegisterQuery,
  OpenRegisterInput,
  UpdateCashMovementInput,
  VerifyProvisionalInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const registerInclude = {
  user: { select: { id: true, name: true, role: true } },
  closed_by: { select: { id: true, name: true } },
  provisional_verified_by: { select: { id: true, name: true } },
  cash_movements: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.CashRegisterInclude;

// Per-shift cash + payment aggregates. Returned alongside every register
// fetched via getRegister/listRegisters so the admin Shifts view can render
// a full payment breakdown (cash / card / transfer / other) and a live
// expected-cash figure for OPEN shifts — without waiting for the immutable
// ShiftReport to be generated at close.
export interface RegisterTotals {
  cash_in: string;
  cash_out: string;
  cash_sales: string;
  card_sales: string;
  transfer_sales: string;
  other_sales: string;
  expected_cash: string;
  total_sales: string;
  // Phase 11 (jar-aparte tips): total of payment.tip_amount across all
  // methods for this shift. Tips never enter the drawer, so they don't
  // affect expected_cash — surfaced separately so the admin view can show
  // "owed to the tip jar" alongside cash totals.
  tips_collected: string;
}

interface PaymentAccum {
  amount: Decimal;
  change: Decimal;
  tip: Decimal;
}

// Computes totals for a batch of register ids in two queries (payments +
// cash movements), then folds them in JS. Cheap even for 50+ shifts because
// each query lives on a single index.
async function computeRegisterTotals(
  client: PrismaLike,
  registerIds: string[],
): Promise<Map<string, RegisterTotals>> {
  const result = new Map<string, RegisterTotals>();
  if (registerIds.length === 0) return result;

  const payments = await client.payment.findMany({
    where: {
      order: {
        register_id: { in: registerIds },
        status: OrderStatus.PAID,
      },
    },
    select: {
      method: true,
      amount: true,
      change_amount: true,
      tip_amount: true,
      order: { select: { register_id: true } },
    },
  });

  const movements = await client.cashMovement.findMany({
    where: { register_id: { in: registerIds } },
    select: { register_id: true, type: true, amount: true },
  });

  const registers = await client.cashRegister.findMany({
    where: { id: { in: registerIds } },
    select: { id: true, opening_amount: true },
  });

  // Bucket payments per register × method. Using strings as keys lets us
  // tolerate any future PaymentMethod additions without touching this code.
  type Method = string;
  const byReg = new Map<string, Map<Method, PaymentAccum>>();
  for (const id of registerIds) byReg.set(id, new Map());
  for (const p of payments) {
    const regId = p.order.register_id;
    const slot = byReg.get(regId);
    if (!slot) continue;
    const existing = slot.get(p.method) ?? {
      amount: new Decimal(0),
      change: new Decimal(0),
      tip: new Decimal(0),
    };
    existing.amount = existing.amount.add(new Decimal(p.amount));
    existing.change = existing.change.add(new Decimal(p.change_amount));
    existing.tip = existing.tip.add(new Decimal(p.tip_amount));
    slot.set(p.method, existing);
  }

  const movByReg = new Map<string, { cashIn: Decimal; cashOut: Decimal }>();
  for (const id of registerIds) movByReg.set(id, { cashIn: new Decimal(0), cashOut: new Decimal(0) });
  for (const m of movements) {
    const slot = movByReg.get(m.register_id);
    if (!slot) continue;
    const amt = new Decimal(m.amount);
    if (m.type === CashMovementType.CASH_IN) {
      slot.cashIn = slot.cashIn.add(amt);
    } else {
      slot.cashOut = slot.cashOut.add(amt);
    }
  }

  for (const reg of registers) {
    const paymentSlot = byReg.get(reg.id) ?? new Map<Method, PaymentAccum>();
    const zero = { amount: new Decimal(0), change: new Decimal(0), tip: new Decimal(0) };
    const cash = paymentSlot.get(PaymentMethod.CASH) ?? zero;
    const card = paymentSlot.get(PaymentMethod.CARD) ?? zero;
    const transfer = paymentSlot.get(PaymentMethod.TRANSFER) ?? zero;

    // "Other" buckets every method that's not cash/card/transfer (e.g.
    // PAYROLL_DEDUCT). Sums their order-side amounts so the breakdown still
    // adds up to total_sales without double-counting tip dollars.
    let otherSales = new Decimal(0);
    let totalTips = new Decimal(0);
    for (const [method, accum] of paymentSlot.entries()) {
      totalTips = totalTips.add(accum.tip);
      if (method === PaymentMethod.CASH) continue;
      if (method === PaymentMethod.CARD) continue;
      if (method === PaymentMethod.TRANSFER) continue;
      otherSales = otherSales.add(accum.amount.sub(accum.tip));
    }

    // Phase 11: payment.amount is gross (sale + tip + change). The drawer
    // only owns the sale portion; tips live in the jar. Subtract tip first,
    // then subtract change.
    const cashSales = cash.amount.sub(cash.tip).sub(cash.change);
    const cardSales = card.amount.sub(card.tip);
    const transferSales = transfer.amount.sub(transfer.tip);
    const mov = movByReg.get(reg.id) ?? { cashIn: new Decimal(0), cashOut: new Decimal(0) };

    // Mirrors closeRegister's expected_amount math so the live OPEN-shift
    // value the admin view shows lines up with what a close right now
    // would compute. Tips are excluded — they never enter the drawer.
    const expectedCash = new Decimal(reg.opening_amount)
      .add(cashSales)
      .add(mov.cashIn)
      .sub(mov.cashOut);

    const totalSales = cashSales
      .add(cardSales)
      .add(transferSales)
      .add(otherSales);

    result.set(reg.id, {
      cash_in: mov.cashIn.toFixed(0),
      cash_out: mov.cashOut.toFixed(0),
      cash_sales: cashSales.toFixed(0),
      card_sales: cardSales.toFixed(0),
      transfer_sales: transferSales.toFixed(0),
      other_sales: otherSales.toFixed(0),
      expected_cash: expectedCash.toFixed(0),
      total_sales: totalSales.toFixed(0),
      tips_collected: totalTips.toFixed(0),
    });
  }

  return result;
}

// Pure helper exported for tests + reuse. The list/get callers below
// hydrate this onto the response shape.
export async function attachRegisterTotals<T extends { id: string }>(
  client: PrismaLike,
  rows: T[],
): Promise<Array<T & { totals: RegisterTotals }>> {
  const totals = await computeRegisterTotals(
    client,
    rows.map((r) => r.id),
  );
  const fallback: RegisterTotals = {
    cash_in: '0',
    cash_out: '0',
    cash_sales: '0',
    card_sales: '0',
    transfer_sales: '0',
    other_sales: '0',
    expected_cash: '0',
    total_sales: '0',
    tips_collected: '0',
  };
  return rows.map((r) => ({ ...r, totals: totals.get(r.id) ?? fallback }));
}

// Roles allowed to close a shift, verify provisional shifts, and process
// cash movements. Anyone outside this set who opens a shift triggers
// is_provisional=true.
export const CASHIER_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.CASHIER,
  UserRole.MANAGER,
  UserRole.ADMIN,
]);

export async function loadOpenRegisterForUser(
  client: PrismaLike,
  userId: string,
): Promise<{ id: string } | null> {
  return client.cashRegister.findFirst({
    where: { user_id: userId, status: CashRegisterStatus.OPEN },
    select: { id: true },
  });
}

// Singleton-shift lookup. The system runs at most one OPEN register at a
// time — orders, takeout flows and the topbar all attach to whichever shift
// is currently open regardless of opener. Returns the open register or null.
export async function loadCurrentOpenRegister(client: PrismaLike = prisma) {
  return client.cashRegister.findFirst({
    where: { status: CashRegisterStatus.OPEN },
    orderBy: { opened_at: 'desc' },
    include: registerInclude,
  });
}

export async function assertRegisterOpen(client: PrismaLike, registerId: string): Promise<void> {
  const row = await client.cashRegister.findUnique({
    where: { id: registerId },
    select: { status: true },
  });
  if (!row) throw new NotFoundError('CashRegister');
  if (row.status !== CashRegisterStatus.OPEN) {
    throw new ConflictError('Cash register is closed — cannot modify orders or cash movements');
  }
}

export async function openRegister(
  userId: string,
  input: OpenRegisterInput,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true, role: true },
    });
    if (!user) throw new BadRequestError('user not found');
    if (!user.active) throw new BadRequestError('user is inactive');

    // Singleton-shift invariant: if any register is already OPEN we refuse.
    const existing = await tx.cashRegister.findFirst({
      where: { status: CashRegisterStatus.OPEN },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        'A shift is already open — close it before opening a new one',
      );
    }

    // Provisional shift: floor staff (waiter/barista) may open when no
    // cashier is on site. The register works for orders only; cash
    // movements are blocked until a cashier+ verifies.
    const isProvisional = !CASHIER_ROLES.has(user.role);

    const register = await tx.cashRegister.create({
      data: {
        user_id: userId,
        opening_amount: new Decimal(input.opening_amount),
        expected_amount: new Decimal(input.opening_amount),
        denomination_breakdown: input.denomination_breakdown ?? Prisma.JsonNull,
        notes: input.notes,
        is_provisional: isProvisional,
      },
      include: registerInclude,
    });
    return register;
  });
}

export interface CloseRegisterContext {
  closingUserId: string;
  closingUserRole: UserRole;
}

export async function closeRegister(
  id: string,
  input: CloseRegisterInput,
  context: CloseRegisterContext,
) {
  if (!CASHIER_ROLES.has(context.closingUserRole)) {
    throw new ForbiddenError('Only a cashier, manager, or admin can close a shift');
  }
  const closed = await prisma.$transaction(async (tx) => {
    // Provisional shifts must be verified before they can close. The
    // verification flow (verifyProvisional) records the partial-cut numbers
    // and flips is_provisional=false; the close that follows is then a
    // regular close. Refusing here keeps the audit trail clean — a single
    // amount on close can't represent both the partial cut and the final
    // count if the shift was provisional.
    const provisional = await tx.cashRegister.findUnique({
      where: { id },
      select: { is_provisional: true, status: true },
    });
    if (!provisional) throw new NotFoundError('CashRegister');
    if (provisional.is_provisional && provisional.status === CashRegisterStatus.OPEN) {
      throw new ConflictError(
        'This is a provisional shift — verify it before closing',
      );
    }

    // Atomic OPEN→CLOSED claim — prevents two close attempts from racing.
    const claim = await tx.cashRegister.updateMany({
      where: { id, status: CashRegisterStatus.OPEN },
      data: { status: CashRegisterStatus.CLOSED },
    });
    if (claim.count === 0) {
      const existing = await tx.cashRegister.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!existing) throw new NotFoundError('CashRegister');
      throw new ConflictError('Cash register is already closed');
    }

    // Authoritative close-flow recomputation. expected_amount is maintained
    // incrementally on every payment / cash movement, but we also recompute
    // from sources here so the close value can't drift from history.
    const register = await tx.cashRegister.findUniqueOrThrow({
      where: { id },
      select: { opening_amount: true },
    });

    const cashPaymentAgg = await tx.payment.aggregate({
      where: {
        method: PaymentMethod.CASH,
        order: { register_id: id, status: OrderStatus.PAID },
      },
      _sum: { amount: true, change_amount: true, tip_amount: true },
    });
    // Tips collected across ALL methods (cash, card, transfer) — informational
    // snapshot for the shift report. Tip dollars don't move through the
    // drawer, so the expected_amount math below subtracts them off the CASH
    // sales total to recover the order-side portion.
    const tipAgg = await tx.payment.aggregate({
      where: { order: { register_id: id, status: OrderStatus.PAID } },
      _sum: { tip_amount: true },
    });
    const tipsCollected = new Decimal(tipAgg._sum.tip_amount ?? 0);
    const cashTips = new Decimal(cashPaymentAgg._sum.tip_amount ?? 0);
    const cashMovementRows = await tx.cashMovement.findMany({
      where: { register_id: id },
      select: { type: true, amount: true },
    });

    const cashIn = cashMovementRows
      .filter((m) => m.type === CashMovementType.CASH_IN)
      .reduce((sum, m) => sum.add(new Decimal(m.amount)), new Decimal(0));
    const cashOut = cashMovementRows
      .filter((m) => m.type === CashMovementType.CASH_OUT)
      .reduce((sum, m) => sum.add(new Decimal(m.amount)), new Decimal(0));

    // amount in cashPaymentAgg is the gross tender (sale + tip). The drawer
    // only holds the sale portion, so subtract cashTips here. The tip jar
    // ledger captures cashTips separately via `tips_collected`.
    const expected = new Decimal(register.opening_amount)
      .add(new Decimal(cashPaymentAgg._sum.amount ?? 0))
      .sub(new Decimal(cashPaymentAgg._sum.change_amount ?? 0))
      .sub(cashTips)
      .add(cashIn)
      .sub(cashOut);

    const actual = new Decimal(input.actual_amount);
    const difference = actual.sub(expected);

    await tx.cashRegister.update({
      where: { id },
      data: {
        expected_amount: expected,
        actual_amount: actual,
        difference,
        tips_collected: tipsCollected,
        denomination_breakdown: input.denomination_breakdown ?? Prisma.JsonNull,
        closed_at: new Date(),
        closed_by_user_id: context.closingUserId,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    // Generate the immutable ShiftReport snapshot inside the same transaction
    // so the report and the closed register commit together. Wrapped in
    // try/catch so a JS-level failure in the report code (logic bug, missing
    // related data, etc.) doesn't take down the close itself — the cashier's
    // count must always land. A Postgres-level error inside the report would
    // still abort the surrounding transaction; that's correct because we'd
    // rather refuse to close than persist a half-built snapshot.
    try {
      await generateShiftReport(tx, id, actual);
    } catch (err) {
      logger.error(
        { err, cash_register_id: id },
        'failed to generate ShiftReport during closeRegister',
      );
    }

    return tx.cashRegister.findUniqueOrThrow({ where: { id }, include: registerInclude });
  });

  emitCloseNotifications(closed, context.closingUserId).catch((err) =>
    logger.error({ err }, 'failed to emit close notifications'),
  );

  return closed;
}

async function emitCloseNotifications(
  closed: { id: string; difference: Prisma.Decimal | null; user: { name: string } },
  closingUserId: string,
) {
  const diffNum = Number(closed.difference ?? 0);
  const userName = closed.user.name;

  notificationBus.emitEvent({
    type: 'SHIFT_CLOSED',
    severity: 'INFO',
    recipient_roles: [UserRole.MANAGER, UserRole.ADMIN],
    title: `Shift closed by ${userName}`,
    body:
      diffNum === 0
        ? 'Drawer balanced'
        : `Variance: $${(Math.abs(diffNum) / 100).toFixed(2)} ${diffNum > 0 ? 'surplus' : 'shortage'}`,
    source_user_id: closingUserId,
    related_resource: { type: 'CashRegister', id: closed.id },
    payload: { difference: diffNum, register_id: closed.id },
  });

  if (diffNum === 0) return;

  const rawNotify = await getSetting(SETTING_KEYS.CASH_VARIANCE_NOTIFY_THRESHOLD);
  const notifyThreshold = rawNotify
    ? Number(rawNotify)
    : CASH_HANDLING_DEFAULTS.VARIANCE_NOTIFY_THRESHOLD;
  const rawBlock = await getSetting(SETTING_KEYS.CASH_VARIANCE_BLOCKING_THRESHOLD);
  const blockingThreshold = rawBlock
    ? Number(rawBlock)
    : CASH_HANDLING_DEFAULTS.VARIANCE_BLOCKING_THRESHOLD;

  if (Math.abs(diffNum) >= notifyThreshold) {
    notificationBus.emitEvent({
      type: 'CASH_SHORTAGE_DETECTED',
      severity: Math.abs(diffNum) >= blockingThreshold ? 'ERROR' : 'WARNING',
      recipient_roles: [UserRole.MANAGER, UserRole.ADMIN],
      title: 'Cash variance detected',
      body: `${userName}'s shift: $${(Math.abs(diffNum) / 100).toFixed(2)} ${diffNum > 0 ? 'surplus' : 'shortage'}`,
      source_user_id: closingUserId,
      related_resource: { type: 'CashRegister', id: closed.id },
      payload: { difference: diffNum, register_id: closed.id },
    });
  }
}

export interface VerifyProvisionalContext {
  verifyingUserId: string;
  verifyingUserRole: UserRole;
}

/**
 * Cashier+ verifies a provisional shift opened by floor staff. Counts the
 * drawer, the diff is recorded on the register, and is_provisional flips to
 * false — the SAME register continues running so orders that were taken
 * pre-verification stay attached.
 *
 * No cash movements happened on a provisional shift (addCashMovement
 * refuses while is_provisional=true), so expected = opening + cash sales
 * (net of change). The diff is informational only; the count is accepted
 * even when it doesn't cuadrar — the audit trail records both numbers.
 */
export async function verifyProvisional(
  id: string,
  input: VerifyProvisionalInput,
  context: VerifyProvisionalContext,
) {
  if (!CASHIER_ROLES.has(context.verifyingUserRole)) {
    throw new ForbiddenError(
      'Only a cashier, manager, or admin can verify a provisional shift',
    );
  }

  return prisma.$transaction(async (tx) => {
    const register = await tx.cashRegister.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        is_provisional: true,
        opening_amount: true,
      },
    });
    if (!register) throw new NotFoundError('CashRegister');
    if (register.status !== CashRegisterStatus.OPEN) {
      throw new ConflictError('Register is closed — cannot verify');
    }
    if (!register.is_provisional) {
      throw new ConflictError('Register is not provisional — already verified');
    }

    const cashPaymentAgg = await tx.payment.aggregate({
      where: {
        method: PaymentMethod.CASH,
        order: { register_id: id, status: OrderStatus.PAID },
      },
      _sum: { amount: true, change_amount: true },
    });

    // Provisional shifts have no CashMovements (addCashMovement refuses), so
    // expected reduces to opening + cash sales − change given.
    const expected = new Decimal(register.opening_amount)
      .add(new Decimal(cashPaymentAgg._sum.amount ?? 0))
      .sub(new Decimal(cashPaymentAgg._sum.change_amount ?? 0));

    const actual = new Decimal(input.actual_amount);
    const difference = actual.sub(expected);

    await tx.cashRegister.update({
      where: { id },
      data: {
        is_provisional: false,
        provisional_verified_by_id: context.verifyingUserId,
        provisional_verified_at: new Date(),
        provisional_expected_amount: expected,
        provisional_actual_amount: actual,
        provisional_difference: difference,
        denomination_breakdown: input.denomination_breakdown ?? Prisma.JsonNull,
        // Keep expected_amount in sync — close-flow recomputes from sources
        // anyway, but having it match the verification diff so far is the
        // honest in-flight value.
        expected_amount: expected,
      },
    });

    return tx.cashRegister.findUniqueOrThrow({ where: { id }, include: registerInclude });
  });
}

export async function getRegister(id: string) {
  const row = await prisma.cashRegister.findUnique({
    where: { id },
    include: registerInclude,
  });
  if (!row) throw new NotFoundError('CashRegister');
  const [hydrated] = await attachRegisterTotals(prisma, [row]);
  return hydrated;
}

export async function listRegisters(query: ListRegisterQuery) {
  const where: Prisma.CashRegisterWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.from || query.to
      ? {
          opened_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.cashRegister.findMany({
    where,
    orderBy: [{ opened_at: 'desc' }, { id: 'asc' }],
    include: registerInclude,
    ...buildCursorArgs(query),
  });
  const hydrated = await attachRegisterTotals(prisma, rows);
  return toPageResult(hydrated, query.limit);
}

/**
 * Refuse to mutate cash movements that belong to a register rolled into a
 * CLOSED DailyReport — the day has been "ended" and any change would silently
 * tamper with the consolidated end-of-day number that managers signed off
 * on. Owners who genuinely need to edit a sealed day have to reopen the
 * DailyReport first (separate flow).
 */
async function assertDayUnlocked(tx: Tx, registerId: string): Promise<void> {
  const row = await tx.cashRegister.findUnique({
    where: { id: registerId },
    select: { daily_report: { select: { status: true } } },
  });
  if (!row) throw new NotFoundError('CashRegister');
  if (row.daily_report && row.daily_report.status === DailyReportStatus.CLOSED) {
    throw new ConflictError(
      'The end-of-day report for this shift is already closed — reopen it before editing cash movements',
    );
  }
}

/**
 * Full recompute of a register's cash totals from the source rows. Called
 * after any cash movement mutation (add/update/delete) so OPEN shifts have a
 * fresh `expected_amount` and CLOSED shifts also get `difference` re-derived
 * against the already-counted `actual_amount` and their ShiftReport
 * snapshot's cash columns patched.
 */
export async function recomputeRegisterTotals(tx: Tx, registerId: string): Promise<void> {
  const reg = await tx.cashRegister.findUnique({
    where: { id: registerId },
    select: {
      id: true,
      status: true,
      opening_amount: true,
      actual_amount: true,
    },
  });
  if (!reg) throw new NotFoundError('CashRegister');

  const cashPaymentAgg = await tx.payment.aggregate({
    where: {
      method: PaymentMethod.CASH,
      order: { register_id: registerId, status: OrderStatus.PAID },
    },
    _sum: { amount: true, change_amount: true },
  });
  const cashMovementRows = await tx.cashMovement.findMany({
    where: { register_id: registerId },
    select: { type: true, amount: true },
  });

  const cashIn = cashMovementRows
    .filter((m) => m.type === CashMovementType.CASH_IN)
    .reduce((sum, m) => sum.add(new Decimal(m.amount)), new Decimal(0));
  const cashOut = cashMovementRows
    .filter((m) => m.type === CashMovementType.CASH_OUT)
    .reduce((sum, m) => sum.add(new Decimal(m.amount)), new Decimal(0));
  const cashSales = new Decimal(cashPaymentAgg._sum.amount ?? 0)
    .sub(new Decimal(cashPaymentAgg._sum.change_amount ?? 0));

  const expected = new Decimal(reg.opening_amount)
    .add(cashSales)
    .add(cashIn)
    .sub(cashOut);

  const data: Prisma.CashRegisterUpdateInput = { expected_amount: expected };
  if (reg.status === CashRegisterStatus.CLOSED && reg.actual_amount !== null) {
    data.difference = new Decimal(reg.actual_amount).sub(expected);
  }
  await tx.cashRegister.update({ where: { id: registerId }, data });

  // For closed shifts with a ShiftReport snapshot, sync the cash columns —
  // sales/voids/products didn't change so the rest of the snapshot stays as
  // the close-time numbers. cash_variance is recomputed against the same
  // actual_cash the cashier counted at close.
  if (reg.status === CashRegisterStatus.CLOSED) {
    const report = await tx.shiftReport.findUnique({
      where: { cash_register_id: registerId },
      select: { id: true, actual_cash: true },
    });
    if (report) {
      const cashInInt = cashIn.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      const cashOutInt = cashOut.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      const expectedCashInt = expected
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      const variance =
        report.actual_cash !== null ? report.actual_cash - expectedCashInt : null;
      await tx.shiftReport.update({
        where: { id: report.id },
        data: {
          cash_in: cashInInt,
          cash_out: cashOutInt,
          expected_cash: expectedCashInt,
          cash_variance: variance,
        },
      });
    }
  }
}

export interface CashMovementContext {
  userId: string;
  userRole: UserRole;
}

function assertCashierContext(ctx: CashMovementContext): void {
  if (!CASHIER_ROLES.has(ctx.userRole)) {
    throw new ForbiddenError(
      'Only a cashier, manager, or admin can manage cash movements',
    );
  }
}

export async function addCashMovement(
  registerId: string,
  ctx: CashMovementContext,
  input: CreateCashMovementInput,
) {
  assertCashierContext(ctx);
  return prisma.$transaction(async (tx) => {
    const reg = await tx.cashRegister.findUnique({
      where: { id: registerId },
      select: { id: true, status: true, is_provisional: true },
    });
    if (!reg) throw new NotFoundError('CashRegister');

    // A closed shift is sealed for new cash movements — once the cashier has
    // counted the drawer and produced a ShiftReport, dropping a fresh
    // CASH_IN/OUT after the fact would silently mutate the expected_amount
    // that was just signed off on. Edits to existing rows still go through
    // updateCashMovement (admin path, day-locked).
    if (reg.status !== CashRegisterStatus.OPEN) {
      throw new ConflictError(
        'Cash register is closed — cannot add cash movements',
      );
    }

    // Provisional shifts only host orders — cash in/out is blocked until a
    // cashier verifies. Otherwise the partial-cut diff at verification would
    // get muddied by floor-staff drawer movements.
    if (reg.is_provisional) {
      throw new ConflictError(
        'Cash movements are blocked on a provisional shift — verify it first',
      );
    }

    const amount = new Decimal(input.amount);
    const movement = await tx.cashMovement.create({
      data: {
        register_id: registerId,
        user_id: ctx.userId,
        type: input.type,
        amount,
        reason: input.reason,
      },
    });

    await recomputeRegisterTotals(tx, registerId);
    return movement;
  });
}

export async function updateCashMovement(
  registerId: string,
  movementId: string,
  ctx: CashMovementContext,
  input: UpdateCashMovementInput,
) {
  assertCashierContext(ctx);
  return prisma.$transaction(async (tx) => {
    const reg = await tx.cashRegister.findUnique({
      where: { id: registerId },
      select: { id: true, status: true, is_provisional: true },
    });
    if (!reg) throw new NotFoundError('CashRegister');
    if (reg.status === CashRegisterStatus.OPEN && reg.is_provisional) {
      throw new ConflictError(
        'Cash movements are blocked on a provisional shift — verify it first',
      );
    }
    if (reg.status === CashRegisterStatus.CLOSED) {
      await assertDayUnlocked(tx, registerId);
    }

    const existing = await tx.cashMovement.findUnique({
      where: { id: movementId },
      select: { id: true, register_id: true },
    });
    if (!existing || existing.register_id !== registerId) {
      throw new NotFoundError('CashMovement');
    }

    await tx.cashMovement.update({
      where: { id: movementId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.amount !== undefined
          ? { amount: new Decimal(input.amount) }
          : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
    });

    await recomputeRegisterTotals(tx, registerId);
    return tx.cashMovement.findUniqueOrThrow({ where: { id: movementId } });
  });
}

export async function deleteCashMovement(
  registerId: string,
  movementId: string,
  ctx: CashMovementContext,
): Promise<void> {
  assertCashierContext(ctx);
  await prisma.$transaction(async (tx) => {
    const reg = await tx.cashRegister.findUnique({
      where: { id: registerId },
      select: { id: true, status: true, is_provisional: true },
    });
    if (!reg) throw new NotFoundError('CashRegister');
    if (reg.status === CashRegisterStatus.OPEN && reg.is_provisional) {
      throw new ConflictError(
        'Cash movements are blocked on a provisional shift — verify it first',
      );
    }
    if (reg.status === CashRegisterStatus.CLOSED) {
      await assertDayUnlocked(tx, registerId);
    }

    const existing = await tx.cashMovement.findUnique({
      where: { id: movementId },
      select: { id: true, register_id: true },
    });
    if (!existing || existing.register_id !== registerId) {
      throw new NotFoundError('CashMovement');
    }

    await tx.cashMovement.delete({ where: { id: movementId } });
    await recomputeRegisterTotals(tx, registerId);
  });
}

export async function listCashMovements(registerId: string, query: ListCashMovementQuery) {
  const exists = await prisma.cashRegister.findUnique({
    where: { id: registerId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('CashRegister');
  const where: Prisma.CashMovementWhereInput = {
    register_id: registerId,
    ...(query.type ? { type: query.type } : {}),
  };
  const rows = await prisma.cashMovement.findMany({
    where,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}
