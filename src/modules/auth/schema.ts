import { z } from 'zod';

// Normalize before validating so leading/trailing whitespace and mixed case
// don't reject a user who typed the right email slightly wrong.
const normalizedEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email().max(200),
);

export const loginSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(1, 'Password is required').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
