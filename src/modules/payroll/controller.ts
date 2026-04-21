import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  GeneratePayrollInput,
  ListPayrollQuery,
  UpdatePayrollInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function generate(req: Request, res: Response): Promise<void> {
  const result = await service.generatePayroll(req.body as GeneratePayrollInput);
  res.status(201).json({ success: true, data: result });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listPayroll(req.query as unknown as ListPayrollQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const record = await service.getPayroll(req.params.id as string);
  res.json({ success: true, data: record });
}

export async function update(req: Request, res: Response): Promise<void> {
  const record = await service.updatePayroll(
    req.params.id as string,
    currentUserId(req),
    req.body as UpdatePayrollInput,
  );
  res.json({ success: true, data: record });
}
