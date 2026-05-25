import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CloseRegisterInput,
  CreateCashMovementInput,
  ListCashMovementQuery,
  ListRegisterQuery,
  OpenRegisterInput,
  UpdateCashMovementInput,
  VerifyProvisionalInput,
} from './schema.js';

function currentUser(req: Request): { id: string; role: import('@prisma/client').UserRole } {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return { id: req.auth.userId, role: req.auth.role };
}

export async function open(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const register = await service.openRegister(user.id, req.body as OpenRegisterInput);
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

export async function verifyProvisional(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const register = await service.verifyProvisional(
    req.params.id as string,
    req.body as VerifyProvisionalInput,
    { verifyingUserId: user.id, verifyingUserRole: user.role },
  );
  res.json({ success: true, data: register });
}

export async function flagForReview(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  await service.flagRegisterForReview(req.params.id as string, user.id);
  res.json({ success: true });
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
  const user = currentUser(req);
  const movement = await service.addCashMovement(
    req.params.id as string,
    { userId: user.id, userRole: user.role },
    req.body as CreateCashMovementInput,
  );
  res.status(201).json({ success: true, data: movement });
}

export async function updateCashMovement(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const movement = await service.updateCashMovement(
    req.params.id as string,
    req.params.movementId as string,
    { userId: user.id, userRole: user.role },
    req.body as UpdateCashMovementInput,
  );
  res.json({ success: true, data: movement });
}

export async function deleteCashMovement(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  await service.deleteCashMovement(
    req.params.id as string,
    req.params.movementId as string,
    { userId: user.id, userRole: user.role },
  );
  res.status(204).end();
}

export async function listCashMovements(req: Request, res: Response): Promise<void> {
  const page = await service.listCashMovements(
    req.params.id as string,
    req.query as unknown as ListCashMovementQuery,
  );
  res.json({ success: true, data: page });
}
