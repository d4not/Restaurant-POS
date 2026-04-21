import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CloseRegisterInput,
  CreateCashMovementInput,
  ListCashMovementQuery,
  ListRegisterQuery,
  OpenRegisterInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function open(req: Request, res: Response): Promise<void> {
  const register = await service.openRegister(
    currentUserId(req),
    req.body as OpenRegisterInput,
  );
  res.status(201).json({ success: true, data: register });
}

export async function close(req: Request, res: Response): Promise<void> {
  const register = await service.closeRegister(
    req.params.id as string,
    req.body as CloseRegisterInput,
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

export async function addCashMovement(req: Request, res: Response): Promise<void> {
  const movement = await service.addCashMovement(
    req.params.id as string,
    currentUserId(req),
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
