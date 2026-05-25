import { z } from 'zod';

const comandaTemplateSchema = z.object({
  print_mode: z.enum(['grouped', 'per_item', 'per_category']).default('grouped'),
  show_order_number: z.boolean().default(true),
  show_table: z.boolean().default(true),
  show_waiter: z.boolean().default(true),
  show_time: z.boolean().default(true),
  show_modifiers: z.boolean().default(true),
  show_notes: z.boolean().default(true),
  show_voided: z.boolean().default(true),
  header_text: z.string().max(100).default('ORDER'),
  footer_text: z.string().max(200).default(''),
  margin_top: z.number().int().min(0).max(5).default(0),
  margin_bottom: z.number().int().min(0).max(5).default(0),
});

const receiptTemplateSchema = z.object({
  show_business_name: z.boolean().default(true),
  show_address: z.boolean().default(true),
  show_order_number: z.boolean().default(true),
  show_datetime: z.boolean().default(true),
  show_cashier: z.boolean().default(true),
  show_table: z.boolean().default(true),
  show_modifiers: z.boolean().default(true),
  show_subtotal: z.boolean().default(true),
  show_tax: z.boolean().default(true),
  show_discount: z.boolean().default(true),
  show_tip: z.boolean().default(true),
  show_total: z.boolean().default(true),
  show_payments: z.boolean().default(true),
  show_change: z.boolean().default(true),
  thank_you_text: z.string().max(200).default('Thank you!'),
  margin_top: z.number().int().min(0).max(5).default(0),
  margin_bottom: z.number().int().min(0).max(5).default(0),
});

export const createProfileSchema = z.object({
  name: z.string().min(1).max(100),
  connection_type: z.enum(['NETWORK', 'USB']).default('NETWORK'),
  address: z.string().max(200).default(''),
  paper_width: z.number().int().refine((v) => [32, 42, 48].includes(v)).default(48),
  printer_model: z.enum(['epson', 'star', 'tanca', 'daruma', 'brother', 'custom']).default('epson'),
  character_set: z.string().max(50).default('PC850_MULTILINGUAL'),
  prints_comandas: z.boolean().default(true),
  prints_receipts: z.boolean().default(false),
  comanda_template: comandaTemplateSchema.optional(),
  receipt_template: receiptTemplateSchema.optional(),
  display_order: z.number().int().default(0),
});

export const updateProfileSchema = createProfileSchema.partial();

export const assignCategoriesSchema = z.object({
  category_ids: z.array(z.string().uuid()),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
