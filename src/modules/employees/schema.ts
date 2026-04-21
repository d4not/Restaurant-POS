import { z } from 'zod';
import { UserRole } from '@prisma/client';

// Accept YYYY-MM-DD date strings as well as full ISO timestamps.
const dateField = z.coerce.date();

export const createEmployeeSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(200),
    pin: z.string().regex(/^\d{4,6}$/, 'pin must be 4-6 digits'),
    password: z.string().min(6).max(200),
    role: z.nativeEnum(UserRole).default('CASHIER'),
    weekly_salary: z.number().int().nonnegative(),
    hire_date: dateField.optional(),
    position: z.string().max(100).optional(),
    phone: z.string().max(40).optional(),
    emergency_contact: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const updateEmployeeSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(200).optional(),
    pin: z.string().regex(/^\d{4,6}$/).optional(),
    password: z.string().min(6).max(200).optional(),
    role: z.nativeEnum(UserRole).optional(),
    active: z.boolean().optional(),
    weekly_salary: z.number().int().nonnegative().nullable().optional(),
    hire_date: dateField.nullable().optional(),
    position: z.string().max(100).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    emergency_contact: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const listEmployeeQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(200).optional(),
  role: z.nativeEnum(UserRole).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeeQuery = z.infer<typeof listEmployeeQuerySchema>;
