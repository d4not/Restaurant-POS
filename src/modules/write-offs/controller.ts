import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateWriteOffBatchInput,
  CreateWriteOffInput,
  ListWriteOffQuery,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const writeOff = await service.createWriteOff(
    currentUserId(req),
    req.body as CreateWriteOffInput,
  );
  res.status(201).json({ success: true, data: writeOff });
}

export async function createBatch(req: Request, res: Response): Promise<void> {
  const rows = await service.createWriteOffBatch(
    currentUserId(req),
    req.body as CreateWriteOffBatchInput,
  );
  res.status(201).json({ success: true, data: rows });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listWriteOffs(req.query as unknown as ListWriteOffQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const row = await service.getWriteOff(req.params.id as string);
  res.json({ success: true, data: row });
}
