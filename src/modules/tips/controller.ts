import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CurrentPoolQuery,
  ListPoolsQuery,
  UpdateAllocationInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listPools(req.query as unknown as ListPoolsQuery);
  res.json({ success: true, data: page });
}

export async function current(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as CurrentPoolQuery;
  const pool = await service.getOrCreateCurrentPool(query.date);
  res.json({ success: true, data: pool });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const pool = await service.getPool((req.params as { id: string }).id);
  res.json({ success: true, data: pool });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const pool = await service.refreshPool((req.params as { id: string }).id);
  res.json({ success: true, data: pool });
}

export async function updateAllocation(req: Request, res: Response): Promise<void> {
  const { id, userId } = req.params as { id: string; userId: string };
  const pool = await service.updateAllocation(id, userId, req.body as UpdateAllocationInput);
  res.json({ success: true, data: pool });
}

export async function close(req: Request, res: Response): Promise<void> {
  const pool = await service.closePool(
    (req.params as { id: string }).id,
    currentUserId(req),
  );
  res.json({ success: true, data: pool });
}

export async function reopen(req: Request, res: Response): Promise<void> {
  const pool = await service.reopenPool((req.params as { id: string }).id);
  res.json({ success: true, data: pool });
}
