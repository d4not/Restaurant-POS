import { z } from 'zod';
import { BaseUnit, ContentUnit, PurchaseStatus, StockMovementType } from '@prisma/client';

const baseUnitEnum = z.nativeEnum(BaseUnit);
const contentUnitEnum = z.nativeEnum(ContentUnit);

const basePayload = z.object({
  barcode: z.string().min(1).max(64).nullable().optional(),
  name: z.string().min(1).max(200),
  category_id: z.string().uuid(),
  base_unit: baseUnitEnum,
  content_per_unit: z.number().positive().optional(),
  content_unit: contentUnitEnum.optional(),
  active: z.boolean().optional(),
});

// Either both content fields are present or both absent — enforcing this in
// the schema avoids a class of unit-conversion bugs in the recipe layer.
const bothOrNeither = (data: {
  content_per_unit?: number | undefined;
  content_unit?: ContentUnit | undefined;
}): boolean =>
  (data.content_per_unit === undefined && data.content_unit === undefined) ||
  (data.content_per_unit !== undefined && data.content_unit !== undefined);

// Create lets the operator seed `average_cost` / `last_cost` from the form so
// a brand-new supply isn't stuck at 0 cost until the first purchase confirms.
// Stored as integer centavos to match Supply.average_cost / Supply.last_cost.
export const createSupplySchema = basePayload
  .extend({
    initial_unit_cost: z.number().int().nonnegative().optional(),
  })
  .refine(bothOrNeither, {
    message: 'content_per_unit and content_unit must be provided together',
    path: ['content_unit'],
  });

// Update mirrors create's optional cost-seed semantics: when the operator
// supplies `unit_cost`, the service writes it to both `average_cost` and
// `last_cost`. Useful to correct a typo from create or to manually anchor
// the WAC before the next purchase confirms.
export const updateSupplySchema = basePayload
  .partial()
  .extend({ unit_cost: z.number().int().nonnegative().optional() })
  .refine(bothOrNeither, {
    message: 'content_per_unit and content_unit must be provided together',
    path: ['content_unit'],
  });

export const listSupplyQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category_id: z.string().uuid().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(200).optional(),
  include_deleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const supplyStockQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Barcodes are 8–14 digits in the wild but we accept any 1–64 char string so
// QR-style internal codes still work. Validation lives at the schema layer
// because the value flows through both an external HTTP call and a DB query.
export const barcodeParamSchema = z.object({
  barcode: z.string().min(1).max(64),
});

export const externalSearchQuerySchema = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

// ─── Phase 2: per-supply analytics endpoints ───────────────────────────────
// Each of these powers a section on the SupplyInfoView page. Cursor-based
// pagination matches the rest of the supplies API; optional date windows
// (`from` / `to`) let the UI narrow to "last 30 days" etc. without a count
// of distinct query schemas. Dates are ISO-8601 strings parsed in service.

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((s) => new Date(s));

export const supplyMovementsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.nativeEnum(StockMovementType).optional(),
});

export const supplyPurchaseHistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDate.optional(),
  to: isoDate.optional(),
  // DRAFT and CANCELLED purchases are noise for an inventory analyst, so the
  // service treats `undefined` as "CONFIRMED only" and `?status=ANY` as the
  // explicit opt-in to see drafts/cancellations too.
  status: z.nativeEnum(PurchaseStatus).optional(),
});

export const supplyCountVarianceQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Phase 4: cascade resolver before soft-delete ──────────────────────────
// Per-RecipeItem resolution. The UI builds one entry per recipe-item that
// references the supply. Items NOT included keep their (about-to-break)
// reference — we surface a `skipped` count in the response so the operator
// can decide whether to re-open the modal.
const resolutionSchema = z
  .object({
    recipe_item_id: z.string().uuid(),
    action: z.enum(['replace', 'remove_line', 'remove_owner']),
    replacement_supply_id: z.string().uuid().optional(),
    // Stored as Decimal(14,4) on the wire; a number is fine since recipes
    // never need precision beyond ~4 dp.
    new_quantity: z.number().positive().optional(),
  })
  .refine((r) => r.action !== 'replace' || r.replacement_supply_id !== undefined, {
    message: 'replacement_supply_id is required when action="replace"',
    path: ['replacement_supply_id'],
  });

export const resolveDependenciesSchema = z.object({
  resolutions: z.array(resolutionSchema),
  // Optional safety net: when true (default) the supply is soft-deleted at
  // the end of the transaction. The UI sends `false` when previewing or when
  // it explicitly only wants to fix the references without removing the supply.
  soft_delete: z.boolean().optional().default(true),
});

export type CreateSupplyInput = z.infer<typeof createSupplySchema>;
export type UpdateSupplyInput = z.infer<typeof updateSupplySchema>;
export type ListSupplyQuery = z.infer<typeof listSupplyQuerySchema>;
export type SupplyStockQuery = z.infer<typeof supplyStockQuerySchema>;
export type ExternalSearchQuery = z.infer<typeof externalSearchQuerySchema>;
export type SupplyMovementsQuery = z.infer<typeof supplyMovementsQuerySchema>;
export type SupplyPurchaseHistoryQuery = z.infer<typeof supplyPurchaseHistoryQuerySchema>;
export type SupplyCountVarianceQuery = z.infer<typeof supplyCountVarianceQuerySchema>;
export type ResolveDependenciesInput = z.infer<typeof resolveDependenciesSchema>;
