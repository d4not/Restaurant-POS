import type { Request, Response } from 'express';
import { SuggestionStatus } from '@prisma/client';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateOrderSuggestionInput,
  ReviewOrderSuggestionInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function list(req: Request, res: Response): Promise<void> {
  // `status` defaults to PENDING in the service if missing or empty; the
  // Suggested Changes view can pass APPROVED / REJECTED for audit views.
  const raw = (req.query.status as string | undefined)?.toUpperCase();
  const status =
    raw && raw in SuggestionStatus ? (raw as SuggestionStatus) : undefined;
  const rows = await service.listOrderSuggestions(status);
  res.json({ success: true, data: rows });
}

export async function create(req: Request, res: Response): Promise<void> {
  const row = await service.createOrderSuggestion(
    currentUserId(req),
    req.params.id as string,
    req.body as CreateOrderSuggestionInput,
  );
  res.status(201).json({ success: true, data: row });
}

export async function approve(req: Request, res: Response): Promise<void> {
  const row = await service.approveOrderSuggestion(
    req.params.id as string,
    req.body as ReviewOrderSuggestionInput,
  );
  res.json({ success: true, data: row });
}

export async function reject(req: Request, res: Response): Promise<void> {
  const row = await service.rejectOrderSuggestion(
    req.params.id as string,
    req.body as ReviewOrderSuggestionInput,
  );
  res.json({ success: true, data: row });
}
