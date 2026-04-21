import { z } from 'zod';
import { PurchaseStatus } from '@prisma/client';

const purchaseItemBody = z.object({
  supply_id: z.string().uuid(),
  packaging_id: z.string().uuid().nullable().optional(),
  package_quantity: z.number().positive(),
  price_per_package: z.number().int().nonnegative(),
});

export const createPurchaseSchema = z.object({
  supplier_id: z.string().uuid(),
  storage_id: z.string().uuid(),
  date: z.coerce.date(),
  payment_method: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(purchaseItemBody).optional(),
});

export const updatePurchaseSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  date: z.coerce.date().optional(),
  payment_method: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const addPurchaseItemSchema = purchaseItemBody;

export const updatePurchaseItemSchema = z.object({
  supply_id: z.string().uuid().optional(),
  packaging_id: z.string().uuid().nullable().optional(),
  package_quantity: z.number().positive().optional(),
  price_per_package: z.number().int().nonnegative().optional(),
});

export const listPurchaseQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(PurchaseStatus).optional(),
  supplier_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type AddPurchaseItemInput = z.infer<typeof addPurchaseItemSchema>;
export type UpdatePurchaseItemInput = z.infer<typeof updatePurchaseItemSchema>;
export type ListPurchaseQuery = z.infer<typeof listPurchaseQuerySchema>;
