import { z } from 'zod';
import { SupplierKind } from '@prisma/client';

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  contact_name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(500).optional(),
  credit_days: z.number().int().min(0).max(365).default(0),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  kind: z.nativeEnum(SupplierKind).optional(),
  // E.164 without leading '+'. Lenient validation: 8-15 digits, optional
  // whitespace/dashes/parens — sanitized again in the WhatsApp link builder.
  whatsapp_phone: z.string().max(32).nullable().optional(),
  message_template: z.string().max(2000).nullable().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSupplierQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(200).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSupplierQuery = z.infer<typeof listSupplierQuerySchema>;
