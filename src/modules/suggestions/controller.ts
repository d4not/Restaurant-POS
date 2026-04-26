import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateSuggestionInput,
  ListSuggestionQuery,
  ReviewSuggestionInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const row = await service.createSuggestion(
    currentUserId(req),
    req.body as CreateSuggestionInput,
  );
  res.status(201).json({ success: true, data: row });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listSuggestions(req.query as unknown as ListSuggestionQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const row = await service.getSuggestion(req.params.id as string);
  res.json({ success: true, data: row });
}

export async function approve(req: Request, res: Response): Promise<void> {
  const row = await service.approveSuggestion(
    req.params.id as string,
    currentUserId(req),
    req.body as ReviewSuggestionInput,
  );
  res.json({ success: true, data: row });
}

export async function reject(req: Request, res: Response): Promise<void> {
  const row = await service.rejectSuggestion(
    req.params.id as string,
    currentUserId(req),
    req.body as ReviewSuggestionInput,
  );
  res.json({ success: true, data: row });
}
