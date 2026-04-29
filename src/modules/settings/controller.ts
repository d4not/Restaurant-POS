import type { Request, Response } from 'express';
import * as service from './service.js';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import { ADMIN_ONLY_SETTING_KEYS, type UpdateSettingsInput } from './schema.js';
import type { UpdateLanguageInput } from './schema.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const settings = await service.getAllSettings();
  res.json({ success: true, data: settings });
}

export async function update(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  const body = req.body as UpdateSettingsInput;
  // ADMIN-only keys cover the printable-report template (report_custom_css /
  // header_html / footer_html — interpolated raw into HTML, so writable XSS
  // surface) plus the non-printer business knobs (default_tax_id, business_*,
  // alert thresholds). Printer keys stay open to CASHIER+ so the operations
  // hub's "Printer check" assign action keeps working.
  const touchesAdminKey = Object.keys(body).some((k) =>
    (ADMIN_ONLY_SETTING_KEYS as readonly string[]).includes(k),
  );
  if (touchesAdminKey && req.auth.role !== 'ADMIN') {
    throw new ForbiddenError('Only ADMIN can update these settings');
  }
  const settings = await service.updateSettings(body);
  res.json({ success: true, data: settings });
}

export async function getLanguage(_req: Request, res: Response): Promise<void> {
  const value = await service.getLanguage();
  res.json({ success: true, data: { value } });
}

export async function setLanguage(req: Request, res: Response): Promise<void> {
  const { value } = req.body as UpdateLanguageInput;
  const saved = await service.setLanguage(value);
  res.json({ success: true, data: { value: saved } });
}
