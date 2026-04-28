import type { Request, Response } from 'express';
import { CashRegisterKind } from '@prisma/client';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CloseRegisterInput,
  CreateCashMovementInput,
  ListCashMovementQuery,
  ListRegisterQuery,
  OpenRegisterInput,
} from './schema.js';

function currentUser(req: Request): { id: string; role: import('@prisma/client').UserRole } {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return { id: req.auth.userId, role: req.auth.role };
}

export async function open(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const register = await service.openRegister(
    user.id,
    req.body as OpenRegisterInput,
    { kind: CashRegisterKind.NORMAL },
  );
  res.status(201).json({ success: true, data: register });
}

export async function close(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const register = await service.closeRegister(
    req.params.id as string,
    req.body as CloseRegisterInput,
    { closingUserId: user.id, closingUserRole: user.role },
  );
  res.json({ success: true, data: register });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const register = await service.getRegister(req.params.id as string);
  res.json({ success: true, data: register });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listRegisters(req.query as unknown as ListRegisterQuery);
  res.json({ success: true, data: page });
}

// GET /registers/current — singleton lookup, returns the only OPEN register
// (or null). Used by the terminal to gate the entire UI on an open shift.
export async function current(_req: Request, res: Response): Promise<void> {
  const register = await service.loadCurrentOpenRegister();
  res.json({ success: true, data: register });
}

export async function addCashMovement(req: Request, res: Response): Promise<void> {
  const movement = await service.addCashMovement(
    req.params.id as string,
    currentUser(req).id,
    req.body as CreateCashMovementInput,
  );
  res.status(201).json({ success: true, data: movement });
}

export async function listCashMovements(req: Request, res: Response): Promise<void> {
  const page = await service.listCashMovements(
    req.params.id as string,
    req.query as unknown as ListCashMovementQuery,
  );
  res.json({ success: true, data: page });
}
