import {
  OrderStatus,
  PaymentMethod,
  Prisma,
  SuggestionStatus,
  SuggestionType,
  type UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors.js';
import {
  reopenOrder,
  softDeleteOrder,
  updatePaymentMethod,
} from '../orders/service.js';
import type {
  CreateOrderSuggestionInput,
  ReviewOrderSuggestionInput,
} from './schema.js';

// Self-PIN check: the PIN must belong to the JWT user, not just to *any*
// cashier on staff. This prevents a logged-in cashier from borrowing a
// nearby coworker's PIN to bypass the audit attribution — the suggestion is
// always recorded against the person who is actually signed in.
async function authorizeSelfPin(
  userId: string,
  pin: string,
): Promise<{ id: string; role: UserRole }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, pin: true, active: true },
  });
  if (!user || !user.active) throw new ForbiddenError('User no longer active');
  if (user.pin !== pin) throw new ForbiddenError('Incorrect PIN');
  if (!['CASHIER', 'MANAGER', 'ADMIN'].includes(user.role)) {
    throw new ForbiddenError('Cashier role required');
  }
  return { id: user.id, role: user.role };
}

async function authorizeManagerPin(pin: string): Promise<string> {
  const matches = await prisma.user.findMany({
    where: { pin, active: true, role: { in: ['MANAGER', 'ADMIN'] } },
    take: 2,
    select: { id: true },
  });
  if (matches.length === 0) throw new ForbiddenError('Manager PIN required');
  if (matches.length > 1) {
    throw new ConflictError(
      'PIN is shared by multiple active users — ask an admin to assign unique PINs',
    );
  }
  return matches[0].id;
}

const ORDER_SUGGESTION_TYPES = new Set<SuggestionType>([
  SuggestionType.ORDER_REOPEN,
  SuggestionType.ORDER_DELETE,
  SuggestionType.ORDER_CHANGE_PAYMENT,
]);

const orderSuggestionInclude = {
  creator: { select: { id: true, name: true, role: true } },
  reviewer: { select: { id: true, name: true, role: true } },
  order: {
    select: {
      id: true,
      order_number: true,
      status: true,
      total: true,
      order_type: true,
      created_at: true,
    },
  },
} satisfies Prisma.SuggestionInclude;

/**
 * List order suggestions for the Suggested Changes admin view. Defaults to
 * PENDING since that's what reviewers act on, but accepts an optional status
 * to surface historical APPROVED / REJECTED rows for audit. Returns newest
 * first.
 */
export async function listOrderSuggestions(
  status: SuggestionStatus = SuggestionStatus.PENDING,
) {
  return prisma.suggestion.findMany({
    where: {
      status,
      type: { in: Array.from(ORDER_SUGGESTION_TYPES) },
    },
    orderBy: { created_at: 'desc' },
    include: orderSuggestionInclude,
    take: 100,
  });
}

/**
 * Build the Suggestion.payload JSON for an order suggestion. The PIN is
 * intentionally NOT stored — it was a step-up auth, not part of the action
 * payload.
 */
function payloadFor(input: CreateOrderSuggestionInput): Prisma.InputJsonValue {
  switch (input.type) {
    case 'ORDER_REOPEN':
      return { reason: input.reason ?? null };
    case 'ORDER_DELETE':
      return { reason: input.reason };
    case 'ORDER_CHANGE_PAYMENT':
      return {
        payment_id: input.payment_id,
        method: input.method,
        reference: input.reference ?? null,
      };
  }
}

/**
 * Validate that the underlying order is in the right state for the proposed
 * action. Catches the obvious "delete an OPEN order" / "change-method on a
 * cancelled ticket" / etc. early so the suggestion queue stays clean.
 */
async function assertOrderEligible(
  orderId: string,
  input: CreateOrderSuggestionInput,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      deleted_at: true,
      order_type: true,
      payments: { select: { id: true, method: true } },
    },
  });
  if (!order) throw new NotFoundError('Order');
  if (order.deleted_at) {
    throw new ConflictError('Cannot propose changes on a deleted order');
  }
  switch (input.type) {
    case 'ORDER_REOPEN':
      if (order.status !== OrderStatus.PAID) {
        throw new ConflictError('Only PAID orders can be reopened');
      }
      break;
    case 'ORDER_DELETE':
      if (order.status === OrderStatus.OPEN) {
        throw new ConflictError('Cancel the order before deleting it from history');
      }
      break;
    case 'ORDER_CHANGE_PAYMENT': {
      if (order.status !== OrderStatus.PAID) {
        throw new ConflictError('Only PAID orders can have payment method changed');
      }
      const payment = order.payments.find((p) => p.id === input.payment_id);
      if (!payment) throw new NotFoundError('Payment');
      if (payment.method === input.method) {
        throw new BadRequestError('Payment is already using that method');
      }
      if (input.method === PaymentMethod.PAYROLL_DEDUCT && order.order_type !== 'EMPLOYEE') {
        throw new BadRequestError('PAYROLL_DEDUCT is only valid on EMPLOYEE orders');
      }
      break;
    }
  }
}

export async function createOrderSuggestion(
  jwtUserId: string,
  orderId: string,
  input: CreateOrderSuggestionInput,
) {
  // The PIN must belong to the user who is currently signed in. We bind the
  // suggestion to the JWT identity rather than letting any cashier's PIN
  // pass, so the audit log always reflects who was at the terminal.
  const approver = await authorizeSelfPin(jwtUserId, input.pin);

  await assertOrderEligible(orderId, input);

  // The partial unique index on (target_order_id WHERE status=PENDING) backs
  // this — but we do an explicit check first so we can return a friendly 409
  // instead of a Prisma P2002.
  const existing = await prisma.suggestion.findFirst({
    where: {
      target_order_id: orderId,
      status: SuggestionStatus.PENDING,
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      'A suggestion is already pending for this order — wait for a manager to review it',
    );
  }

  const type = mapInputTypeToEnum(input.type);
  return prisma.suggestion.create({
    data: {
      type,
      payload: payloadFor(input),
      note: input.note ?? null,
      target_order_id: orderId,
      created_by: approver.id,
    },
    include: orderSuggestionInclude,
  });
}

function mapInputTypeToEnum(t: CreateOrderSuggestionInput['type']): SuggestionType {
  switch (t) {
    case 'ORDER_REOPEN': return SuggestionType.ORDER_REOPEN;
    case 'ORDER_DELETE': return SuggestionType.ORDER_DELETE;
    case 'ORDER_CHANGE_PAYMENT': return SuggestionType.ORDER_CHANGE_PAYMENT;
  }
}

/**
 * Manager-authorised approve: re-runs the proposed action through the same
 * service the direct endpoint uses, then flips the suggestion to APPROVED.
 * The manager's PIN is validated TWICE — once here to record the reviewer,
 * and again inside the order service so the audit fields (`cancelled_by`,
 * `deleted_by`, `approved_by`) reflect the approving manager.
 */
export async function approveOrderSuggestion(
  suggestionId: string,
  input: ReviewOrderSuggestionInput,
) {
  const reviewerId = await authorizeManagerPin(input.pin);

  const sug = await prisma.suggestion.findUnique({
    where: { id: suggestionId },
    select: {
      id: true,
      status: true,
      type: true,
      payload: true,
      target_order_id: true,
    },
  });
  if (!sug) throw new NotFoundError('Suggestion');
  if (!ORDER_SUGGESTION_TYPES.has(sug.type)) {
    throw new BadRequestError('Not an order suggestion');
  }
  if (sug.status !== SuggestionStatus.PENDING) {
    throw new ConflictError(`Suggestion is already ${sug.status.toLowerCase()}`);
  }
  if (!sug.target_order_id) {
    throw new BadRequestError('Suggestion has no target order');
  }

  const payload = sug.payload as Record<string, unknown>;

  switch (sug.type) {
    case SuggestionType.ORDER_REOPEN: {
      const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
      await reopenOrder(sug.target_order_id, { pin: input.pin, reason });
      break;
    }
    case SuggestionType.ORDER_DELETE: {
      const reason = String(payload.reason ?? '').trim();
      if (reason.length < 5) {
        throw new BadRequestError('Stored reason is invalid — reject and resubmit');
      }
      await softDeleteOrder(sug.target_order_id, { pin: input.pin, reason });
      break;
    }
    case SuggestionType.ORDER_CHANGE_PAYMENT: {
      const paymentId = String(payload.payment_id ?? '');
      const method = payload.method as PaymentMethod;
      const reference = payload.reference == null ? null : String(payload.reference);
      if (!paymentId || !method) {
        throw new BadRequestError('Stored payload is incomplete — reject and resubmit');
      }
      await updatePaymentMethod(sug.target_order_id, paymentId, {
        pin: input.pin,
        method,
        reference,
      });
      break;
    }
    default:
      throw new BadRequestError('Unsupported suggestion type');
  }

  return prisma.suggestion.update({
    where: { id: suggestionId },
    data: {
      status: SuggestionStatus.APPROVED,
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      review_note: input.review_note ?? null,
    },
    include: orderSuggestionInclude,
  });
}

export async function rejectOrderSuggestion(
  suggestionId: string,
  input: ReviewOrderSuggestionInput,
) {
  const reviewerId = await authorizeManagerPin(input.pin);

  const sug = await prisma.suggestion.findUnique({
    where: { id: suggestionId },
    select: { id: true, status: true, type: true },
  });
  if (!sug) throw new NotFoundError('Suggestion');
  if (!ORDER_SUGGESTION_TYPES.has(sug.type)) {
    throw new BadRequestError('Not an order suggestion');
  }
  if (sug.status !== SuggestionStatus.PENDING) {
    throw new ConflictError(`Suggestion is already ${sug.status.toLowerCase()}`);
  }

  return prisma.suggestion.update({
    where: { id: suggestionId },
    data: {
      status: SuggestionStatus.REJECTED,
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      review_note: input.review_note ?? null,
    },
    include: orderSuggestionInclude,
  });
}
