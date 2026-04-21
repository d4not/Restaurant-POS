import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type { CreateTransferInput, ListTransferQuery } from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const transfer = await service.createTransfer(
    currentUserId(req),
    req.body as CreateTransferInput,
  );
  res.status(201).json({ success: true, data: transfer });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listTransfers(req.query as unknown as ListTransferQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const transfer = await service.getTransfer(req.params.id as string);
  res.json({ success: true, data: transfer });
}
