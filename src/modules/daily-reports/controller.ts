import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CloseDailyReportInput,
  ListDailyReportQuery,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function close(req: Request, res: Response): Promise<void> {
  const report = await service.closeDailyReport(
    currentUserId(req),
    req.body as CloseDailyReportInput,
  );
  res.json({ success: true, data: report });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listDailyReports(
    req.query as unknown as ListDailyReportQuery,
  );
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const report = await service.getDailyReport(req.params.id as string);
  res.json({ success: true, data: report });
}

export async function printReport(req: Request, res: Response): Promise<void> {
  const html = await service.renderDailyReportHtml(req.params.id as string);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
