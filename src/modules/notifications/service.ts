import type { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getSetting } from '../settings/service.js';
import {
  CASH_HANDLING_DEFAULTS,
  SETTING_KEYS,
} from '../settings/schema.js';
import { notificationBus } from './event-bus.js';
import {
  severityBypassesQuietHours,
  type NotificationEvent,
} from './event-types.js';
import {
  inMemoryStore,
  type ListOptions,
  type StoredNotification,
} from './providers/in-app.js';
import { webPushProvider } from './providers/web-push.js';
import { capacitorProvider } from './providers/capacitor.js';

/**
 * Dispatch a notification event to its recipients.
 *
 * Resolution:
 *   1. Master switch — `notifications_enabled = false` ⇒ no-op (still returns
 *      `{ delivered: 0 }` so callers don't need to special-case).
 *   2. Quiet hours — non-critical events suppressed within the window.
 *   3. Recipient set = `recipient_user_ids ∪ users-with-recipient_roles`.
 *      Both filtered to active users; deduped.
 *   4. Per recipient, push to in-app store and fan out to web-push +
 *      capacitor providers (stubs in Track A).
 *
 * Returns the number of in-app rows created (not # of push notifications
 * actually delivered to devices — those happen asynchronously).
 */
export async function dispatch(
  event: NotificationEvent,
): Promise<{ delivered: number }> {
  const enabled = await readEnabled();
  if (!enabled) {
    return { delivered: 0 };
  }

  const isCritical = severityBypassesQuietHours(event.severity);
  if (!isCritical) {
    const quiet = await readQuietHours();
    if (isWithinQuietHours(new Date(), quiet.start, quiet.end)) {
      return { delivered: 0 };
    }
  }

  const recipients = await resolveRecipients(event);
  if (recipients.length === 0) {
    return { delivered: 0 };
  }

  let delivered = 0;
  for (const userId of recipients) {
    const stored = inMemoryStore.push(userId, event);
    delivered++;
    // Provider dispatch is fire-and-forget — failures shouldn't block the
    // in-app delivery that already succeeded.
    void webPushProvider.dispatch(userId, stored).catch(() => {});
    void capacitorProvider.dispatch(userId, stored).catch(() => {});
  }
  return { delivered };
}

/** Read API used by the controller. Thin wrapper around the in-app store. */
export function listForUser(
  userId: string,
  opts?: ListOptions,
): { items: StoredNotification[]; unread_count: number } {
  const items = inMemoryStore.listForUser(userId, opts);
  const unread_count = inMemoryStore.unreadCount(userId);
  return { items, unread_count };
}

export function markRead(
  notifId: string,
  userId: string,
): StoredNotification | null {
  return inMemoryStore.markRead(notifId, userId);
}

/* ───────────────────────── internals ───────────────────────── */

async function readEnabled(): Promise<boolean> {
  const raw = await getSetting(SETTING_KEYS.NOTIFICATIONS_ENABLED);
  if (raw === null) return CASH_HANDLING_DEFAULTS.NOTIFICATIONS_ENABLED;
  return raw === 'true';
}

async function readQuietHours(): Promise<{ start: string; end: string }> {
  const start =
    (await getSetting(SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_START)) ??
    CASH_HANDLING_DEFAULTS.QUIET_HOURS_START;
  const end =
    (await getSetting(SETTING_KEYS.NOTIFICATIONS_QUIET_HOURS_END)) ??
    CASH_HANDLING_DEFAULTS.QUIET_HOURS_END;
  return { start, end };
}

/**
 * Pure quiet-hours predicate. Handles both same-day (08:00→17:00) and
 * wrap-midnight (22:00→07:00) windows; `start === end` disables the gate.
 */
export function isWithinQuietHours(
  now: Date,
  start: string,
  end: string,
): boolean {
  const startMin = parseHHmm(start);
  const endMin = parseHHmm(end);
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (startMin < endMin) {
    return minutes >= startMin && minutes < endMin;
  }
  return minutes >= startMin || minutes < endMin;
}

function parseHHmm(s: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

async function resolveRecipients(event: NotificationEvent): Promise<string[]> {
  const fromIds = (event.recipient_user_ids ?? []).slice();
  const fromRoles = await usersWithRoles(event.recipient_roles ?? []);
  const all = Array.from(new Set([...fromIds, ...fromRoles]));
  // Don't send the originator a copy of their own action — feels noisy.
  if (event.source_user_id) {
    return all.filter((id) => id !== event.source_user_id);
  }
  return all;
}

async function usersWithRoles(roles: UserRole[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { role: { in: roles }, active: true },
    select: { id: true },
  });
  return rows.map((u) => u.id);
}

/* ───────────────────────── bus wiring ───────────────────────── */

// Subscribe ONCE per process so multiple imports of this file don't multiply
// listeners. `wired` is set on the bus itself (a hidden symbol) so a vitest
// test that re-imports the module doesn't double-register.
const WIRED = Symbol.for('notifications.bus.wired');
type WiredBus = typeof notificationBus & { [WIRED]?: true };
const bus = notificationBus as WiredBus;
if (!bus[WIRED]) {
  bus[WIRED] = true;
  bus.on('*', (event: NotificationEvent) => {
    void dispatch(event).catch((err) => {
      // Notifications must never break the originating flow. Log and move on.
      // eslint-disable-next-line no-console
      console.error('[notifications] dispatch failed:', err);
    });
  });
}
