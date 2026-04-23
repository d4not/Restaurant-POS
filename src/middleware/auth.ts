import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import type { UserRole } from '@prisma/client';

export interface AuthContext {
  userId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Bearer-token guard: verifies the JWT issued by POST /auth/login (or the
// terminal's POST /auth/pin-login) and attaches { userId, role } to the
// request. Both login paths produce the same token shape so downstream
// handlers don't need to care which one ran.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      role: UserRole;
    };
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
};

// Role gate. Use AFTER requireAuth on a route. Accepts the roles permitted to
// hit the endpoint and rejects everyone else with 403. The auth context is
// guaranteed to be present because requireAuth has already populated it — but
// we still check, so a misordered router doesn't silently grant access.
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError('Missing auth context'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new ForbiddenError(`Requires one of: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}
