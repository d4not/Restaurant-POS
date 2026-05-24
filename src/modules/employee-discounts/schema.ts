import { z } from 'zod';

// EmployeeProduct: a Product (and optional Variant) sold to staff at an
// admin-typed price. The price is independent from the regular menu — the
// admin types the exact centavo amount, no markup formula.
export const createEmployeeProductSchema = z
  .object({
    product_id: z.string().uuid(),
    variant_id: z.string().uuid().nullable().optional(),
    employee_price: z.number().int().min(0),
    label: z.string().max(200).nullable().optional(),
    active: z.boolean().optional(),
    display_order: z.number().int().min(0).optional(),
  })
  .strict();

export const updateEmployeeProductSchema = z
  .object({
    employee_price: z.number().int().min(0).optional(),
    label: z.string().max(200).nullable().optional(),
    active: z.boolean().optional(),
    display_order: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export const listEmployeeProductsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  active: z.preprocess((v) => {
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }, z.boolean().optional()),
  product_id: z.string().uuid().optional(),
});

// EmployeeSale: an actual handout — staff member X received product Y at the
// custom price. employee_user_id can be any active User (the recipient role
// gate is the service layer, not this schema).
export const createEmployeeSaleSchema = z
  .object({
    employee_product_id: z.string().uuid(),
    employee_user_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(99).default(1),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

export const listEmployeeSalesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  employee_user_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  register_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateEmployeeProductInput = z.infer<typeof createEmployeeProductSchema>;
export type UpdateEmployeeProductInput = z.infer<typeof updateEmployeeProductSchema>;
export type ListEmployeeProductsQuery = z.infer<typeof listEmployeeProductsQuerySchema>;
export type CreateEmployeeSaleInput = z.infer<typeof createEmployeeSaleSchema>;
export type ListEmployeeSalesQuery = z.infer<typeof listEmployeeSalesQuerySchema>;
