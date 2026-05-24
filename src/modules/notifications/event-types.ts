/**
 * Notification event taxonomy. Events flow through the singleton
 * `notificationBus` (see ./event-bus); the service translates each event into
 * one or more `Notification` records and dispatches via the configured
 * providers (in-app, web push, capacitor).
 *
 * Track A scope: in-app provider only. Web push + capacitor land in Track B
 * (they need a `PushSubscription` table and a Capacitor plugin install
 * respectively).
 */

import type { UserRole } from '@prisma/client';

export const NOTIFICATION_EVENT_TYPES = [
  /** A cashier just closed a shift. Severity: INFO unless variance present. */
  'SHIFT_CLOSED',
  /** Variance at close exceeded the notify threshold. Severity: WARNING. */
  'CASH_SHORTAGE_DETECTED',
  /** Waiter/cashier hit the "notify manager" button mid-count. */
  'MANAGER_HELP_REQUESTED',
  /** Provisional shift never verified — cron caught it after N hours. */
  'SHIFT_UNVERIFIED_OVERNIGHT',
  /** End-of-day report committed by a manager+. Severity: INFO. */
  'DAILY_REPORT_CLOSED',
  /** Synthetic event for ops to validate the dispatch wiring works. */
  'TEST',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_SEVERITIES = [
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * Shape every emitter sends through the bus. The dispatch service fans this
 * out: resolves `recipient_roles` to user IDs via Prisma, applies the
 * settings gate (enabled? quiet hours?), records per recipient.
 */
export interface NotificationEvent {
  type: NotificationEventType;
  severity: NotificationSeverity;
  /** Explicit user IDs that should receive this. May be empty. */
  recipient_user_ids?: string[];
  /** Roles that should receive this — resolved at dispatch to active users. */
  recipient_roles?: UserRole[];
  /** Short headline for push notifications + bell list. */
  title: string;
  /** Longer prose body. Markdown not parsed today; plain text. */
  body: string;
  /** Structured data the UI can use for deep-link / inline rendering. */
  payload?: Record<string, unknown>;
  /** User who triggered the event ("Sofia requested help"). */
  source_user_id?: string;
  /** Resource the notification links to (admin click → audit view). */
  related_resource?: {
    type:
      | 'CashRegister'
      | 'ShiftReport'
      | 'DailyReport'
      | 'Alert'
      | 'Order';
    id: string;
  };
}

/** Severity is critical when it must bypass quiet hours. */
export function severityBypassesQuietHours(s: NotificationSeverity): boolean {
  return s === 'CRITICAL';
}
