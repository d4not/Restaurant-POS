import { z } from 'zod';
import { BaseUnit, ContentUnit } from '@prisma/client';

const baseUnitEnum = z.nativeEnum(BaseUnit);
const contentUnitEnum = z.nativeEnum(ContentUnit);

const basePayload = z.object({
  barcode: z.string().min(1).max(64).optional(),
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

export const createSupplySchema = basePayload.refine(bothOrNeither, {
  message: 'content_per_unit and content_unit must be provided together',
  path: ['content_unit'],
});

export const updateSupplySchema = basePayload.partial().refine(bothOrNeither, {
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

export type CreateSupplyInput = z.infer<typeof createSupplySchema>;
export type UpdateSupplyInput = z.infer<typeof updateSupplySchema>;
export type ListSupplyQuery = z.infer<typeof listSupplyQuerySchema>;
export type SupplyStockQuery = z.infer<typeof supplyStockQuerySchema>;
