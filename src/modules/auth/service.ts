import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { User, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';
import type { LoginInput, PinLoginInput } from './schema.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

function signToken(user: Pick<User, 'id' | 'role'>): string {
  return jwt.sign(
    { sub: user.id, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as SignOptions,
  );
}

function toAuthUser(user: User): AuthUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * Authenticate with email + password. We always run bcrypt.compare even when
 * the user doesn't exist so the response time doesn't leak which emails are
 * registered (timing-safe enumeration defense). Same error message either way.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Constant-ish work even when the email is unknown — compare against a
  // dummy hash so the total time doesn't short-circuit.
  const hashToCheck =
    user?.password_hash ?? '$2a$10$CwTycUXWue0Thq9StjUM0uJ8k1o0p9w1GzQXgM8sHtJkL4PwJQ3yi';
  const passwordMatches = await bcrypt.compare(input.password, hashToCheck);

  if (!user || !user.active || !passwordMatches) {
    throw new UnauthorizedError('Invalid email or password');
  }

  return { token: signToken(user), user: toAuthUser(user) };
}

/**
 * Authenticate with a 4-6 digit PIN entered on the terminal. PINs are stored
 * plaintext on User.pin (short, low-entropy by design — the protection model
 * is "physical access to the terminal" rather than "cryptographic secret").
 *
 * If two active users share the same PIN we refuse the login with a 409 — the
 * cashier needs to distinguish themselves before they can ring up sales. Same
 * generic error otherwise so we don't leak whether a particular PIN exists.
 */
export async function pinLogin(input: PinLoginInput): Promise<LoginResult> {
  const matches = await prisma.user.findMany({
    where: { pin: input.pin, active: true },
    take: 2,
  });

  if (matches.length === 0) {
    throw new UnauthorizedError('Invalid PIN');
  }
  if (matches.length > 1) {
    throw new ConflictError(
      'PIN is shared by multiple active users — ask an admin to assign unique PINs',
    );
  }

  const user = matches[0];
  return { token: signToken(user), user: toAuthUser(user) };
}

/**
 * Fetch the currently-authenticated user (resolved from `req.auth.userId`).
 * Returns 401 if the user was deleted or deactivated between requests.
 */
export async function getCurrentUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new UnauthorizedError('User no longer active');
  }
  return toAuthUser(user);
}

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 10);
}
