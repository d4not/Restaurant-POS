import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateInventoryCheckInput,
  ListInventoryCheckQuery,
  SetCheckItemsInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const check = await service.createInventoryCheck(
    currentUserId(req),
    req.body as CreateInventoryCheckInput,
  );
  res.status(201).json({ success: true, data: check });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listInventoryChecks(
    req.query as unknown as ListInventoryCheckQuery,
  );
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const check = await service.getInventoryCheck(req.params.id as string);
  res.json({ success: true, data: check });
}

export async function setItems(req: Request, res: Response): Promise<void> {
  const check = await service.setCheckItems(
    req.params.id as string,
    req.body as SetCheckItemsInput,
  );
  res.json({ success: true, data: check });
}

export async function complete(req: Request, res: Response): Promise<void> {
  const check = await service.completeInventoryCheck(req.params.id as string);
  res.json({ success: true, data: check });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteInventoryCheck(req.params.id as string);
  res.status(204).send();
}
