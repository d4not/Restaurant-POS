import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  ListUnverifiedQuery,
  OpenProvisionalShiftInput,
  VerifyShiftInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function openProvisional(req: Request, res: Response): Promise<void> {
  const register = await service.openProvisionalShift(
    currentUserId(req),
    req.body as OpenProvisionalShiftInput,
  );
  res.status(201).json({ success: true, data: register });
}

export async function verify(req: Request, res: Response): Promise<void> {
  const register = await service.verifyProvisionalShift(
    req.params.id as string,
    req.body as VerifyShiftInput,
  );
  res.json({ success: true, data: register });
}

export async function listUnverified(req: Request, res: Response): Promise<void> {
  const page = await service.listUnverifiedProvisionalShifts(
    req.query as unknown as ListUnverifiedQuery,
  );
  res.json({ success: true, data: page });
}
