import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type { ListAlertQuery, LowStockQuery, ResolveAlertInput } from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function lowStock(req: Request, res: Response): Promise<void> {
  const items = await service.listLowStock(req.query as unknown as LowStockQuery);
  res.json({ success: true, data: { items } });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listAlerts(req.query as unknown as ListAlertQuery);
  res.json({ success: true, data: page });
}

export async function resolve(req: Request, res: Response): Promise<void> {
  const alert = await service.resolveAlert(
    req.params.id as string,
    currentUserId(req),
    req.body as ResolveAlertInput,
  );
  res.json({ success: true, data: alert });
}
