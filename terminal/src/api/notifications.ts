import { api } from './client';

/**
 * Shape of one notification row. Mirrors the in-memory store on the backend
 * (`src/modules/notifications/providers/in-app.ts → StoredNotification`).
 * Track B swaps the store for a Prisma table with the same fields, so this
 * surface stays stable.
 */
export interface NotificationRow {
  id: string;
  user_id: string;
  type:
    | 'SHIFT_CLOSED'
    | 'CASH_SHORTAGE_DETECTED'
    | 'MANAGER_HELP_REQUESTED'
    | 'SHIFT_UNVERIFIED_OVERNIGHT'
    | 'DAILY_REPORT_CLOSED'
    | 'TEST';
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  body: string;
  payload: Record<string, unknown>;
  source_user_id: string | null;
  related_resource_type: string | null;
  related_resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationRow[];
  unread_count: number;
}

export interface ListNotificationsParams {
  limit?: number;
  unreadOnly?: boolean;
}

export function listNotifications(
  params?: ListNotificationsParams,
): Promise<NotificationListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.unreadOnly) qs.set('unread_only', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return api.get<NotificationListResponse>(`/notifications${suffix}`);
}

export function markNotificationRead(id: string): Promise<NotificationRow> {
  return api.post<NotificationRow>(`/notifications/${id}/read`);
}

export interface SendTestNotificationInput {
  type?: NotificationRow['type'];
  severity?: NotificationRow['severity'];
  title?: string;
  body?: string;
  recipient_roles?: Array<'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER'>;
  recipient_user_ids?: string[];
}

export function sendTestNotification(
  input: SendTestNotificationInput = {},
): Promise<{ accepted: true }> {
  return api.post<{ accepted: true }>('/notifications/test', input);
}
