import { z } from 'zod';

// Body for POST /api/v1/registers/provisional. Per REPORTS-SPEC.md §3.1
// the parent shift id is required — the provisional inherits the parent's
// drawer (opening_amount = 0) and the parent stays OPEN while the side-flow
// runs.
export const openProvisionalShiftSchema = z
  .object({
    parent_shift_id: z.string().uuid(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

// Body for POST /api/v1/registers/:id/verify. The PIN is matched against any
// active MANAGER/ADMIN inside the service so a manager walking up after the
// shift closed can sign off without needing to swap JWTs.
export const verifyShiftSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const listUnverifiedQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type OpenProvisionalShiftInput = z.infer<typeof openProvisionalShiftSchema>;
export type VerifyShiftInput = z.infer<typeof verifyShiftSchema>;
export type ListUnverifiedQuery = z.infer<typeof listUnverifiedQuerySchema>;
