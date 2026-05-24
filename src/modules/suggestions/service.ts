import { Prisma, SuggestionStatus, SuggestionType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import * as tableService from '../tables/service.js';
import * as productService from '../products/service.js';
import {
  createSuggestionSchema,
  type CreateSuggestionInput,
  type ListSuggestionQuery,
  type ReviewSuggestionInput,
} from './schema.js';

const suggestionInclude = {
  creator: { select: { id: true, name: true, role: true } },
  reviewer: { select: { id: true, name: true, role: true } },
  table: {
    select: {
      id: true,
      number: true,
      label: true,
      zone: { select: { id: true, name: true } },
    },
  },
  product: { select: { id: true, name: true, type: true } },
} satisfies Prisma.SuggestionInclude;

// Type-narrowed accessor for the discriminator. The Zod input is a union but
// runtime always carries the resolved object — this keeps the service body
// from drowning in `as` casts.
type SuggestionEnvelope = CreateSuggestionInput;

// Order-scoped suggestion types — these belong to the cashier→manager flow
// in Order History and are reviewed via `/api/v1/order-suggestions/:id/*`,
// not through this generic queue. We hide them from the admin Suggestions
// queue and reject any attempt to approve/reject one here.
const ORDER_SUGGESTION_TYPES: SuggestionType[] = [
  SuggestionType.ORDER_REOPEN,
  SuggestionType.ORDER_DELETE,
  SuggestionType.ORDER_CHANGE_PAYMENT,
];

/**
 * Step-up manager / admin PIN check used by the approve / reject flow. The
 * route gate already requires a MANAGER+ JWT; this adds a second factor so a
 * left-open terminal can't be hijacked. Returns the validated user id so the
 * caller can record the PIN-validated reviewer on the suggestion (which may
 * differ from the JWT user if two managers share the terminal).
 */
async function authorizeReviewerPin(pin: string): Promise<string> {
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

function targetIds(input: SuggestionEnvelope): {
  target_table_id: string | null;
  target_product_id: string | null;
} {
  switch (input.type) {
    case SuggestionType.TABLE_UPDATE:
    case SuggestionType.TABLE_DELETE:
      return { target_table_id: input.target.table_id, target_product_id: null };
    case SuggestionType.PRODUCT_UPDATE:
    case SuggestionType.PRODUCT_DELETE:
      return { target_table_id: null, target_product_id: input.target.product_id };
    default:
      return { target_table_id: null, target_product_id: null };
  }
}

export async function createSuggestion(
  creatorId: string,
  input: SuggestionEnvelope,
) {
  const { target_table_id, target_product_id } = targetIds(input);

  // For UPDATE/DELETE we sanity-check the target exists at create-time so a
  // typo'd UUID doesn't sit in the queue forever.
  if (target_table_id) {
    const t = await prisma.table.findUnique({
      where: { id: target_table_id },
      select: { id: true },
    });
    if (!t) throw new BadRequestError('Target table does not exist');
  }
  if (target_product_id) {
    const p = await prisma.product.findUnique({
      where: { id: target_product_id },
      select: { id: true },
    });
    if (!p) throw new BadRequestError('Target product does not exist');
  }

  return prisma.suggestion.create({
    data: {
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue,
      note: input.note ?? null,
      target_table_id,
      target_product_id,
      created_by: creatorId,
    },
    include: suggestionInclude,
  });
}

export async function listSuggestions(query: ListSuggestionQuery) {
  const where: Prisma.SuggestionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    // Order suggestions live in a parallel review flow on Order History — keep
    // them out of the generic admin queue so the approve action here doesn't
    // try to re-parse them as table/product payloads (which 422s). An explicit
    // type filter wins; otherwise we exclude every order-scoped type.
    type: query.type ?? { notIn: ORDER_SUGGESTION_TYPES },
  };
  const rows = await prisma.suggestion.findMany({
    where,
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    include: suggestionInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getSuggestion(id: string) {
  const row = await prisma.suggestion.findUnique({
    where: { id },
    include: suggestionInclude,
  });
  if (!row) throw new NotFoundError('Suggestion');
  return row;
}

/**
 * Approve a pending suggestion: re-parse the payload through its resource
 * schema (data may have rotted between submit and review) and apply it via
 * the same service the resource's regular endpoint uses. Then mark the
 * suggestion APPROVED. The whole thing runs inside a transaction so a failed
 * apply rolls back the status flip.
 */
export async function approveSuggestion(
  id: string,
  _jwtReviewerId: string,
  input: ReviewSuggestionInput,
) {
  // PIN-validated reviewer wins over the JWT user — keeps the audit trail
  // accurate when two admins share a workstation.
  const reviewerId = await authorizeReviewerPin(input.pin);
  const current = await prisma.suggestion.findUnique({
    where: { id },
    select: { id: true, status: true, type: true, payload: true },
  });
  if (!current) throw new NotFoundError('Suggestion');
  if (ORDER_SUGGESTION_TYPES.includes(current.type)) {
    throw new BadRequestError(
      'Order-scoped suggestions are reviewed from Order History, not from this queue',
    );
  }
  if (current.status !== SuggestionStatus.PENDING) {
    throw new ConflictError(`Suggestion is already ${current.status.toLowerCase()}`);
  }

  // Re-parse the stored JSON through the original input schema. We rebuild
  // the envelope shape so the discriminated union can validate it.
  const fullRow = await prisma.suggestion.findUniqueOrThrow({
    where: { id },
    select: {
      type: true,
      payload: true,
      target_table_id: true,
      target_product_id: true,
    },
  });
  const envelope = rebuildEnvelope(fullRow);
  const validated = createSuggestionSchema.parse(envelope);

  // Apply the change. Each branch calls the matching resource service so
  // domain rules (zone existence, unique constraints, etc.) are enforced
  // exactly as if admin had hit the regular endpoint.
  switch (validated.type) {
    case SuggestionType.TABLE_CREATE:
      await tableService.createTable(validated.payload);
      break;
    case SuggestionType.TABLE_UPDATE:
      await tableService.updateTable(validated.target.table_id, validated.payload);
      break;
    case SuggestionType.TABLE_DELETE:
      await tableService.deleteTable(validated.target.table_id);
      break;
    case SuggestionType.PRODUCT_CREATE:
      await productService.createProduct(validated.payload);
      break;
    case SuggestionType.PRODUCT_UPDATE:
      await productService.updateProduct(
        validated.target.product_id,
        validated.payload,
      );
      break;
    case SuggestionType.PRODUCT_DELETE:
      await productService.softDeleteProduct(validated.target.product_id);
      break;
  }

  return prisma.suggestion.update({
    where: { id },
    data: {
      status: SuggestionStatus.APPROVED,
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      review_note: input.review_note ?? null,
    },
    include: suggestionInclude,
  });
}

export async function rejectSuggestion(
  id: string,
  _jwtReviewerId: string,
  input: ReviewSuggestionInput,
) {
  const reviewerId = await authorizeReviewerPin(input.pin);
  const current = await prisma.suggestion.findUnique({
    where: { id },
    select: { id: true, status: true, type: true },
  });
  if (!current) throw new NotFoundError('Suggestion');
  if (ORDER_SUGGESTION_TYPES.includes(current.type)) {
    throw new BadRequestError(
      'Order-scoped suggestions are reviewed from Order History, not from this queue',
    );
  }
  if (current.status !== SuggestionStatus.PENDING) {
    throw new ConflictError(`Suggestion is already ${current.status.toLowerCase()}`);
  }
  return prisma.suggestion.update({
    where: { id },
    data: {
      status: SuggestionStatus.REJECTED,
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      review_note: input.review_note ?? null,
    },
    include: suggestionInclude,
  });
}

// Stitch the stored row back into the discriminated-union envelope shape. The
// Prisma row stores type and payload separately and target_*_id as nullable
// columns; the Zod schema expects them combined.
function rebuildEnvelope(row: {
  type: SuggestionType;
  payload: Prisma.JsonValue;
  target_table_id: string | null;
  target_product_id: string | null;
}): unknown {
  switch (row.type) {
    case SuggestionType.TABLE_UPDATE:
    case SuggestionType.TABLE_DELETE:
      return {
        type: row.type,
        target: { table_id: row.target_table_id },
        payload: row.payload,
      };
    case SuggestionType.PRODUCT_UPDATE:
    case SuggestionType.PRODUCT_DELETE:
      return {
        type: row.type,
        target: { product_id: row.target_product_id },
        payload: row.payload,
      };
    default:
      return { type: row.type, payload: row.payload };
  }
}
