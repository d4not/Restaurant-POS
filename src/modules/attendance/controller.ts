import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateAttendanceInput,
  ListAttendanceQuery,
  UpdateAttendanceInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const record = await service.logAttendance(
    currentUserId(req),
    req.body as CreateAttendanceInput,
  );
  res.status(201).json({ success: true, data: record });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listAttendance(req.query as unknown as ListAttendanceQuery);
  res.json({ success: true, data: page });
}

export async function update(req: Request, res: Response): Promise<void> {
  const record = await service.updateAttendance(
    req.params.id as string,
    req.body as UpdateAttendanceInput,
  );
  res.json({ success: true, data: record });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteAttendance(req.params.id as string);
  res.status(204).send();
}
