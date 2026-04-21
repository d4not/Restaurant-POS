import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { env } from '../../src/config/env.js';

export function signTestToken(userId: string, role: UserRole = 'ADMIN'): string {
  return jwt.sign({ sub: userId, role }, env.JWT_SECRET, { expiresIn: '1h' });
}

export function authHeader(userId: string, role: UserRole = 'ADMIN'): { Authorization: string } {
  return { Authorization: `Bearer ${signTestToken(userId, role)}` };
}
