import {
  CashMovementType,
  CashRegisterStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
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
  cash_movements: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.CashRegisterInclude;

export async function loadOpenRegisterForUser(
  client: PrismaLike,
  userId: string,
): Promise<{ id: string } | null> {
  return client.cashRegister.findFirst({
    where: { user_id: userId, status: CashRegisterStatus.OPEN },
    select: { id: true },
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

export async function openRegister(userId: string, input: OpenRegisterInput) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true },
    });
    if (!user) throw new BadRequestError('user not found');
    if (!user.active) throw new BadRequestError('user is inactive');

    const existing = await loadOpenRegisterForUser(tx, userId);
    if (existing) {
      throw new ConflictError('User already has an open cash register');
    }

    const register = await tx.cashRegister.create({
      data: {
        user_id: userId,
        opening_amount: new Decimal(input.opening_amount),
        expected_amount: new Decimal(input.opening_amount),
        notes: input.notes,
      },
      include: registerInclude,
    });
    return register;
  });
}

export async function closeRegister(id: string, input: CloseRegisterInput) {
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
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
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
  return row;
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
  return toPageResult(rows, query.limit);
}

export async function addCashMovement(
  registerId: string,
  userId: string,
  input: CreateCashMovementInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertRegisterOpen(tx, registerId);
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
