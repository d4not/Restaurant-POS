import type { Request, Response } from 'express';
import { UnauthorizedError, NotFoundError } from '../../lib/errors.js';
import * as service from './service.js';
import { notificationBus } from './event-bus.js';
import type { ListNotificationsQuery, SendTestInput } from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const q = req.query as unknown as ListNotificationsQuery;
  const out = service.listForUser(userId, {
    limit: q.limit,
    unreadOnly: q.unread_only,
  });
  res.json({ success: true, data: out });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const notifId = req.params.id as string;
  const row = service.markRead(notifId, userId);
  if (!row) {
    throw new NotFoundError('Notification not found');
  }
  res.json({ success: true, data: row });
}

/**
 * ADMIN-only — emits a synthetic event through the bus so operators can
 * verify the whole dispatch chain works end-to-end (bus → service →
 * provider). Defaults to a TEST event addressed at MANAGER+ADMIN. Override
 * any field via the body.
 */
export async function sendTest(req: Request, res: Response): Promise<void> {
  const adminId = currentUserId(req);
  const input = (req.body ?? {}) as SendTestInput;
  notificationBus.emitEvent({
    type: input.type ?? 'TEST',
    severity: input.severity ?? 'INFO',
    title: input.title ?? 'Test notification',
    body:
      input.body ??
      'If you can see this, the notifications pipeline is wired up correctly.',
    recipient_roles: input.recipient_roles ?? ['MANAGER', 'ADMIN'],
    recipient_user_ids: input.recipient_user_ids ?? [],
    source_user_id: adminId,
  });
  res.json({ success: true, data: { accepted: true } });
}
