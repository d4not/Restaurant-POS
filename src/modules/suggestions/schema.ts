import { z } from 'zod';
import { SuggestionStatus, SuggestionType } from '@prisma/client';
import { createTableSchema, updateTableSchema } from '../tables/schema.js';
import {
  createProductSchema,
  updateProductSchema,
} from '../products/schema.js';

// A suggestion is "what would you do if you were admin?" — the payload mirrors
// the body the corresponding resource endpoint would have accepted, validated
// here so an obviously-bad proposal fails fast at create time. We re-validate
// at approve time too, since data the payload references (zone, category)
// could vanish between submission and review.

const targetTableId = z.object({ table_id: z.string().uuid() });

export const tableCreateSuggestion = z.object({
  type: z.literal('TABLE_CREATE' satisfies SuggestionType),
  payload: createTableSchema,
});

export const tableUpdateSuggestion = z.object({
  type: z.literal('TABLE_UPDATE' satisfies SuggestionType),
  target: targetTableId,
  payload: updateTableSchema,
});

export const tableDeleteSuggestion = z.object({
  type: z.literal('TABLE_DELETE' satisfies SuggestionType),
  target: targetTableId,
  payload: z.object({}).strict().default({}),
});

const targetProductId = z.object({ product_id: z.string().uuid() });

export const productCreateSuggestion = z.object({
  type: z.literal('PRODUCT_CREATE' satisfies SuggestionType),
  payload: createProductSchema,
});

export const productUpdateSuggestion = z.object({
  type: z.literal('PRODUCT_UPDATE' satisfies SuggestionType),
  target: targetProductId,
  payload: updateProductSchema,
});

export const productDeleteSuggestion = z.object({
  type: z.literal('PRODUCT_DELETE' satisfies SuggestionType),
  target: targetProductId,
  payload: z.object({}).strict().default({}),
});

const suggestionEnvelope = z.discriminatedUnion('type', [
  tableCreateSuggestion,
  tableUpdateSuggestion,
  tableDeleteSuggestion,
  productCreateSuggestion,
  productUpdateSuggestion,
  productDeleteSuggestion,
]);

export const createSuggestionSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .and(suggestionEnvelope);

export const reviewSuggestionSchema = z
  .object({
    // Admin step-up PIN. The route gate already requires an ADMIN JWT, but
    // we re-authenticate against an active admin's PIN so a logged-in
    // terminal can't be hijacked into approving / rejecting without a fresh
    // physical confirmation. Matches the gate on order-suggestion review.
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    review_note: z.string().trim().max(500).optional(),
  })
  .strict();

export const listSuggestionQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.nativeEnum(SuggestionStatus).optional(),
  type: z.nativeEnum(SuggestionType).optional(),
});

export type CreateSuggestionInput = z.infer<typeof createSuggestionSchema>;
export type ReviewSuggestionInput = z.infer<typeof reviewSuggestionSchema>;
export type ListSuggestionQuery = z.infer<typeof listSuggestionQuerySchema>;
