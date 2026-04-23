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

// PIN login: 4–6 digit numeric PIN entered on the terminal numpad. Strict
// length and digit enforcement so a typo turns into a 422 immediately rather
// than a slow, indistinguishable "Invalid PIN" further down.
export const pinLoginSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;
