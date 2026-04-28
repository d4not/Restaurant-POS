import {
  CashMovementType,
  CashRegisterKind,
  CashRegisterStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  ShiftType,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { logger } from '../../lib/logger.js';
import { generateShiftReport } from '../shift-reports/service.js';
import type {
  CloseRegisterInput,
  CreateCashMovementInput,
  ListCashMovementQuery,
  ListRegisterQuery,
  OpenRegisterInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const registerInclude = {
  user: { select: { id: true, name: true } },
  closed_by: { select: { id: true, name: true } },
  cash_movements: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.CashRegisterInclude;

// Roles allowed to close any shift (provisional or normal). Single source of
// truth for both the route gate and the in-service authorisation when a
// provisional close also opens a follow-up normal shift.
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

export interface OpenRegisterContext {
  kind: CashRegisterKind;
}

export async function openRegister(
  userId: string,
  input: OpenRegisterInput,
  context: OpenRegisterContext = { kind: CashRegisterKind.NORMAL },
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true },
    });
    if (!user) throw new BadRequestError('user not found');
    if (!user.active) throw new BadRequestError('user is inactive');

    // Singleton-shift invariant: if any register is already OPEN we refuse.
    // The arriving cashier must close the current shift (often a provisional
    // one) before opening a new normal shift.
    const existing = await tx.cashRegister.findFirst({
      where: { status: CashRegisterStatus.OPEN },
      select: { id: true, kind: true },
    });
    if (existing) {
      throw new ConflictError(
        existing.kind === CashRegisterKind.PROVISIONAL
          ? 'A provisional shift is already open — close it before opening a new one'
          : 'A shift is already open — close it before opening a new one',
      );
    }

    const register = await tx.cashRegister.create({
      data: {
        user_id: userId,
        kind: context.kind,
        opening_amount: new Decimal(input.opening_amount),
        expected_amount: new Decimal(input.opening_amount),
        notes: input.notes,
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
  return prisma.$transaction(async (tx) => {
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
      _sum: { amount: true, change_amount: true },
    });
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

    const expected = new Decimal(register.opening_amount)
      .add(new Decimal(cashPaymentAgg._sum.amount ?? 0))
      .sub(new Decimal(cashPaymentAgg._sum.change_amount ?? 0))
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
}

export async function getRegister(id: string) {
  const row = await prisma.cashRegister.findUnique({
    where: { id },
    include: registerInclude,
  });
  if (!row) throw new NotFoundError('CashRegister');
  return row;
}

export async function listRegisters(query: ListRegisterQuery) {
  const where: Prisma.CashRegisterWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
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
  return toPageResult(rows, query.limit);
}

export async function addCashMovement(
  registerId: string,
  userId: string,
  input: CreateCashMovementInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertRegisterOpen(tx, registerId);
    // Provisional shifts are payment-only. Any non-sale cash motion (tips
    // dropped in, petty cash out) belongs on the parent regular shift —
    // the cashier reconciles on close, not the floor staff mid-shift.
    const reg = await tx.cashRegister.findUniqueOrThrow({
      where: { id: registerId },
      select: { type: true },
    });
    if (reg.type === ShiftType.PROVISIONAL) {
      throw new ForbiddenError(
        'Cash movements are not allowed on a provisional shift',
      );
    }
    const amount = new Decimal(input.amount);

    const movement = await tx.cashMovement.create({
      data: {
        register_id: registerId,
        user_id: userId,
        type: input.type,
        amount,
        reason: input.reason,
      },
    });

    // Keep expected_amount in sync incrementally.
    const delta = input.type === CashMovementType.CASH_IN ? amount : amount.neg();
    await tx.cashRegister.update({
      where: { id: registerId },
      data: { expected_amount: { increment: delta } },
    });

    return movement;
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
