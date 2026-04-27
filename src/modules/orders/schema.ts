import { z } from 'zod';
import { OrderStatus, OrderType, PaymentMethod, TakeoutChannel } from '@prisma/client';

// Free-text fields shared by create + update. Empty strings are coerced to
// null at the service layer so blanks from the form don't leak into the DB.
const takeoutCustomerFields = {
  customer_name: z.string().max(120).nullable().optional(),
  customer_phone: z.string().max(40).nullable().optional(),
  delivery_address: z.string().max(500).nullable().optional(),
  delivery_reference: z.string().max(500).nullable().optional(),
  delivery_driver_name: z.string().max(120).nullable().optional(),
  delivery_app: z.string().max(80).nullable().optional(),
  delivery_app_order_id: z.string().max(80).nullable().optional(),
};

export const createOrderSchema = z
  .object({
    register_id: z.string().uuid(),
    order_type: z.nativeEnum(OrderType),
    // Optional table assignment. Only meaningful for DINE_IN orders — TAKEOUT
    // with a table_id is rejected at the service level.
    table_id: z.string().uuid().nullable().optional(),
    // Required when order_type=TAKEOUT, ignored for DINE_IN. Service-layer
    // validates "is this channel currently active in settings".
    takeout_channel: z.nativeEnum(TakeoutChannel).optional(),
    notes: z.string().max(2000).optional(),
    ...takeoutCustomerFields,
  })
  .strict();

export const updateOrderSchema = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    discount_amount: z.number().int().nonnegative().optional(),
    discount_reason: z.string().max(500).nullable().optional(),
    order_type: z.nativeEnum(OrderType).optional(),
    // Pass null to detach the order from its table; pass a UUID to reseat it.
    table_id: z.string().uuid().nullable().optional(),
    // Reroute a TAKEOUT order to a different channel (e.g. customer originally
    // walked up but ends up wanting delivery). Cleared automatically when
    // order_type flips to DINE_IN.
    takeout_channel: z.nativeEnum(TakeoutChannel).nullable().optional(),
    ...takeoutCustomerFields,
  })
  .strict();

export const listOrderQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(OrderStatus).optional(),
  register_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  order_type: z.nativeEnum(OrderType).optional(),
  table_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const addOrderItemSchema = z
  .object({
    product_id: z.string().uuid(),
    variant_id: z.string().uuid().nullable().optional(),
    quantity: z.number().int().positive().default(1),
    modifier_ids: z.array(z.string().uuid()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

// `pin` is required at the service layer when the target item already has
// sent_to_kitchen=true — the schema keeps it optional so the cashier can
// freely edit unsent lines without a re-auth dance.
//
// variant_id and modifier_ids let the cashier reconfigure an existing line
// without removing-and-re-adding it (which would lose the original sent_at /
// added_by audit trail). Both are validated and re-priced server-side; the
// snapshot tax_rate is preserved so the receipt math stays stable across
// menu price changes.
export const updateOrderItemSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    notes: z.string().max(2000).nullable().optional(),
    variant_id: z.string().uuid().nullable().optional(),
    modifier_ids: z.array(z.string().uuid()).optional(),
    pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .strict();

// Remove may carry an optional reason (mirrors the cancel-order audit trail).
// The reason is only stored when the line is sent — for unsent items the row
// is hard-deleted, so there's nowhere to keep the reason.
export const removeOrderItemSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

// Restore = un-void a previously voided line. Always requires cashier PIN
// because the void itself was a privileged action.
export const restoreOrderItemSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .strict();

export const createPaymentSchema = z
  .object({
    method: z.nativeEnum(PaymentMethod),
    amount: z.number().int().positive(),
    reference: z.string().max(200).nullable().optional(),
    // Required only when the JWT user is WAITER/BARISTA. Validated against any
    // active CASHIER/MANAGER/ADMIN PIN by the service layer; the matching user
    // is persisted on Payment.approved_by_user_id for audit.
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits').optional(),
  })
  .strict();

// Waiter flips needs_attention=true with an optional reason; cashier flips it
// back to false (reason is cleared server-side).
export const requestAttentionSchema = z
  .object({
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();

// Cancel-order body. The fields are *conditionally* required at the service
// layer: if any line was already sent to the kitchen, the kitchen has been
// told to make food and the cashier (any active CASHIER/MANAGER/ADMIN) must
// approve via PIN with a written reason. For untouched / unsent orders the
// waiter can cancel without ceremony — both fields stay optional here so
// validation doesn't trip on the "free cancel" path.
export const cancelOrderSchema = z
  .object({
    reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(500).optional(),
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits').optional(),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ListOrderQuery = z.infer<typeof listOrderQuerySchema>;
export type AddOrderItemInput = z.infer<typeof addOrderItemSchema>;
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type RequestAttentionInput = z.infer<typeof requestAttentionSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type RemoveOrderItemInput = z.infer<typeof removeOrderItemSchema>;
export type RestoreOrderItemInput = z.infer<typeof restoreOrderItemSchema>;
