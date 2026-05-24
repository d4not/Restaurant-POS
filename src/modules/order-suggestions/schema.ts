import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';

// Cashier-proposed history edits. The cashier presses Reopen / Delete /
// Change-payment on the Order History screen, types THEIR OWN PIN (any active
// cashier+), and the proposed action is queued as a Suggestion instead of
// executing. A manager later approves or rejects from the same screen.
//
// Each variant carries the full set of allowed keys inline so the
// discriminated union can stay `.strict()` (the body cannot smuggle extra
// fields) while still accepting the shared pin / note keys. Composing with
// `.and(z.object({pin, note}))` would re-introduce unknown-key errors on the
// strict leaves, so we inline instead.

const pinField = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits');
const noteField = z.string().trim().max(500).optional();

const reopenSuggestion = z
  .object({
    type: z.literal('ORDER_REOPEN'),
    pin: pinField,
    note: noteField,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const deleteSuggestion = z
  .object({
    type: z.literal('ORDER_DELETE'),
    pin: pinField,
    note: noteField,
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

const changePaymentSuggestion = z
  .object({
    type: z.literal('ORDER_CHANGE_PAYMENT'),
    pin: pinField,
    note: noteField,
    payment_id: z.string().uuid(),
    method: z.nativeEnum(PaymentMethod),
    reference: z.string().max(200).nullable().optional(),
  })
  .strict();

export const createOrderSuggestionSchema = z.discriminatedUnion('type', [
  reopenSuggestion,
  deleteSuggestion,
  changePaymentSuggestion,
]);

export const reviewOrderSuggestionSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    review_note: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateOrderSuggestionInput = z.infer<typeof createOrderSuggestionSchema>;
export type ReviewOrderSuggestionInput = z.infer<typeof reviewOrderSuggestionSchema>;
