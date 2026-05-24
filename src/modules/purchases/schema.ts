import { z } from 'zod';
import { PurchaseKind, PurchaseStatus } from '@prisma/client';

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
  kind: z.nativeEnum(PurchaseKind).optional(),
  payment_method: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
  expected_arrival: z.coerce.date().nullable().optional(),
  items: z.array(purchaseItemBody).optional(),
});

export const updatePurchaseSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  date: z.coerce.date().optional(),
  payment_method: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  expected_arrival: z.coerce.date().nullable().optional(),
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
  kind: z.nativeEnum(PurchaseKind).optional(),
  supplier_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  runner_user_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ─── Lifecycle transition bodies ────────────────────────────────────────────

// SUPPLIER_REPLIED: per-item availability flag; optional totals from the
// supplier's verbal/text reply.
export const replyPurchaseSchema = z.object({
  supplier_subtotal: z.number().int().nonnegative().nullable().optional(),
  shipping_cost: z.number().int().nonnegative().nullable().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        unavailable: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const payPurchaseSchema = z.object({
  payment_reference: z.string().max(120).nullable().optional(),
});

export const inTransitSchema = z.object({
  expected_arrival: z.coerce.date().nullable().optional(),
});

// Per-item received quantities (in PACKAGES, same unit as package_quantity).
// Used by both ARRIVED (delivery) and RETURNED (errand), and accepted again
// by VERIFY as a manager override.
const receivedItemBody = z.object({
  id: z.string().uuid(),
  received_package_quantity: z.number().nonnegative(),
  shortfall_reason: z.string().max(120).nullable().optional(),
});

export const receiveSchema = z.object({
  items: z.array(receivedItemBody).optional(),
});

export const verifySchema = z.object({
  items: z.array(receivedItemBody).optional(),
});

export const dispatchSchema = z.object({
  runner_user_id: z.string().uuid(),
  cash_advanced: z.number().int().positive(),
  reason: z.string().max(120).optional(),
});

export const returnSchema = z.object({
  cash_returned: z.number().int().nonnegative().optional(),
  reason: z.string().max(120).optional(),
  items: z.array(receivedItemBody).optional(),
});

export const cancelSchema = z.object({
  cancel_reason: z.string().min(5).max(500),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type AddPurchaseItemInput = z.infer<typeof addPurchaseItemSchema>;
export type UpdatePurchaseItemInput = z.infer<typeof updatePurchaseItemSchema>;
export type ListPurchaseQuery = z.infer<typeof listPurchaseQuerySchema>;
export type ReplyPurchaseInput = z.infer<typeof replyPurchaseSchema>;
export type PayPurchaseInput = z.infer<typeof payPurchaseSchema>;
export type InTransitInput = z.infer<typeof inTransitSchema>;
export type ReceiveInput = z.infer<typeof receiveSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;
export type DispatchInput = z.infer<typeof dispatchSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
