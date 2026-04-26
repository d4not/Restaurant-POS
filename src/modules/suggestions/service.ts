import { Prisma, SuggestionStatus, SuggestionType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
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
    ...(query.type ? { type: query.type } : {}),
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
  reviewerId: string,
  input: ReviewSuggestionInput,
) {
  const current = await prisma.suggestion.findUnique({
    where: { id },
    select: { id: true, status: true, type: true, payload: true },
  });
  if (!current) throw new NotFoundError('Suggestion');
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
  reviewerId: string,
  input: ReviewSuggestionInput,
) {
  const current = await prisma.suggestion.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!current) throw new NotFoundError('Suggestion');
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
