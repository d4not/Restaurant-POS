import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';
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

// Bearer-token guard: verifies the JWT issued by POST /auth/login and
// attaches { userId, role } to the request. Refresh tokens and PIN login
// land in a later phase.
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
