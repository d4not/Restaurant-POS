import type { Request, Response } from 'express';
import * as service from './service.js';
import { UnauthorizedError } from '../../lib/errors.js';
import type { LoginInput, PinLoginInput } from './schema.js';

export async function login(req: Request, res: Response): Promise<void> {
  const result = await service.login(req.body as LoginInput);
  res.json({ success: true, data: result });
}

export async function pinLogin(req: Request, res: Response): Promise<void> {
  const result = await service.pinLogin(req.body as PinLoginInput);
  res.json({ success: true, data: result });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const user = await service.getCurrentUser(req.auth.userId);
  res.json({ success: true, data: user });
}
