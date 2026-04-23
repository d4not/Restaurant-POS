import { z } from 'zod';
import { OrderStatus, OrderType, PaymentMethod } from '@prisma/client';

export const createOrderSchema = z
  .object({
    register_id: z.string().uuid(),
    order_type: z.nativeEnum(OrderType),
    // Optional table assignment. Only meaningful for DINE_IN orders — TAKEOUT
    // with a table_id is rejected at the service level.
    table_id: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).optional(),
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

export const updateOrderItemSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const createPaymentSchema = z
  .object({
    method: z.nativeEnum(PaymentMethod),
    amount: z.number().int().positive(),
    reference: z.string().max(200).nullable().optional(),
  })
  .strict();

// Waiter flips needs_attention=true with an optional reason; cashier flips it
// back to false (reason is cleared server-side).
export const requestAttentionSchema = z
  .object({
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ListOrderQuery = z.infer<typeof listOrderQuerySchema>;
export type AddOrderItemInput = z.infer<typeof addOrderItemSchema>;
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type RequestAttentionInput = z.infer<typeof requestAttentionSchema>;
