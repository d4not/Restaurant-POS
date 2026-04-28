import {
  CashRegisterKind,
  CashRegisterStatus,
  Prisma,
  ShiftType,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import type {
  ListUnverifiedQuery,
  OpenProvisionalShiftInput,
  VerifyShiftInput,
} from './schema.js';

const registerInclude = {
  user: { select: { id: true, name: true } },
  closed_by: { select: { id: true, name: true } },
  verified_by: { select: { id: true, name: true } },
  parent_shift: { select: { id: true, status: true, type: true } },
} satisfies Prisma.CashRegisterInclude;

/**
 * Open a provisional shift attached to an OPEN regular shift. Per
 * REPORTS-SPEC.md §3.1, any authenticated user can fire this when the
 * cashier-on-duty is busy and a side-flow needs its own register window. The
 * parent shift stays OPEN; the provisional inherits the drawer (opening = 0)
 * and must be verified by a manager+ after close. The legacy `kind` column
 * is mirrored to PROVISIONAL too so order/payment paths that still read
 * `kind` see the marker.
 */
export async function openProvisionalShift(
  userId: string,
  input: OpenProvisionalShiftInput,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, active: true },
    });
    if (!user) throw new BadRequestError('user not found');
    if (!user.active) throw new BadRequestError('user is inactive');

    const parent = await tx.cashRegister.findUnique({
      where: { id: input.parent_shift_id },
      select: { id: true, status: true, type: true },
    });
    if (!parent) {
      throw new BadRequestError('parent_shift_id references a non-existent register');
    }
    if (parent.type !== ShiftType.REGULAR) {
      throw new BadRequestError('Parent shift must be a REGULAR shift');
    }
    if (parent.status !== CashRegisterStatus.OPEN) {
      throw new ConflictError(
        'Parent shift is closed — cannot open a provisional against it',
      );
    }

    return tx.cashRegister.create({
      data: {
        user_id: userId,
        kind: CashRegisterKind.PROVISIONAL,
        type: ShiftType.PROVISIONAL,
        parent_shift_id: parent.id,
        requires_verification: true,
        opening_amount: new Decimal(0),
        expected_amount: new Decimal(0),
        notes: input.notes,
      },
      include: registerInclude,
    });
  });
}

/**
 * PIN step-up for provisional verification. Same shape as the cashier-PIN
 * authorisation in orders/service.ts but filtered to MANAGER/ADMIN — only
 * those roles can sign off on a provisional's reconciliation. Returns the
 * matching user so the audit trail can record who verified.
 */
async function authorizeManagerPin(
  client: Prisma.TransactionClient,
  pin: string,
): Promise<{ id: string; name: string }> {
  const matches = await client.user.findMany({
    where: {
      pin,
      active: true,
      role: { in: [UserRole.MANAGER, UserRole.ADMIN] },
    },
    take: 2,
    select: { id: true, name: true },
  });
  if (matches.length === 0) {
    throw new ForbiddenError('PIN does not match any active manager or admin');
  }
  if (matches.length > 1) {
    throw new ConflictError(
      'PIN is shared by multiple active users — ask an admin to assign unique PINs',
    );
  }
  return matches[0];
}

/**
 * Verify a closed provisional shift. The shift must already be CLOSED — the
 * cashier counts cash at close, then a manager+ comes by and signs off here.
 * Idempotent: re-verifying an already-verified shift is rejected so the
 * audit fields are write-once.
 */
export async function verifyProvisionalShift(
  shiftId: string,
  input: VerifyShiftInput,
) {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.cashRegister.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        status: true,
        type: true,
        verified_at: true,
      },
    });
    if (!shift) throw new NotFoundError('CashRegister');
    if (shift.type !== ShiftType.PROVISIONAL) {
      throw new BadRequestError('Only PROVISIONAL shifts can be verified');
    }
    if (shift.status !== CashRegisterStatus.CLOSED) {
      throw new ConflictError(
        'Shift must be CLOSED before it can be verified',
      );
    }
    if (shift.verified_at) {
      throw new ConflictError('Shift is already verified');
    }

    const verifier = await authorizeManagerPin(tx, input.pin);

    await tx.cashRegister.update({
      where: { id: shiftId },
      data: {
        verified_by_id: verifier.id,
        verified_at: new Date(),
        verification_notes: input.notes ?? null,
      },
    });

    return tx.cashRegister.findUniqueOrThrow({
      where: { id: shiftId },
      include: registerInclude,
    });
  });
}

/**
 * List CLOSED PROVISIONAL shifts whose `verified_at` is still null — i.e.
 * shifts waiting on a manager+ signature. Drives the admin queue surface.
 */
export async function listUnverifiedProvisionalShifts(
  query: ListUnverifiedQuery,
) {
  const where: Prisma.CashRegisterWhereInput = {
    type: ShiftType.PROVISIONAL,
    status: CashRegisterStatus.CLOSED,
    verified_at: null,
  };
  const rows = await prisma.cashRegister.findMany({
    where,
    orderBy: [{ closed_at: 'desc' }, { id: 'asc' }],
    include: registerInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}
