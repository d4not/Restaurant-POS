import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type { ListShiftReportQuery } from './schema.js';

function currentUser(req: Request): { id: string; role: UserRole } {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return { id: req.auth.userId, role: req.auth.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listShiftReports(req.query as unknown as ListShiftReportQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const report = await service.getShiftReport(req.params.id as string);
  // Per REPORTS-SPEC §3.2 + §8: MANAGER/ADMIN can read any report; CASHIER
  // can read their own. Lower roles never reach here (route gate blocks
  // them) but we still check defensively to keep the rule colocated.
  const isManagerPlus = user.role === UserRole.MANAGER || user.role === UserRole.ADMIN;
  if (!isManagerPlus && report.user_id !== user.id) {
    throw new ForbiddenError('Cannot view another user\'s shift report');
  }
  res.json({ success: true, data: report });
}

export async function printReport(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const report = await service.getShiftReport(req.params.id as string);
  // Same gate as getById — CASHIER can print their own, MANAGER/ADMIN any.
  // The HTML response leaks the same data either way, so the same rule
  // applies.
  const isManagerPlus = user.role === UserRole.MANAGER || user.role === UserRole.ADMIN;
  if (!isManagerPlus && report.user_id !== user.id) {
    throw new ForbiddenError('Cannot print another user\'s shift report');
  }
  const html = await service.renderShiftReportHtml(req.params.id as string);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
