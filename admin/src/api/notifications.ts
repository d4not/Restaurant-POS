import { api } from './client';

/**
 * Mirrors `terminal/src/api/notifications.ts`. Admin web and POS terminal
 * share the same backend module; the only difference is the HTTP client.
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
  unread_only?: boolean;
}

export function listNotifications(params: ListNotificationsParams = {}) {
  return api.get<NotificationListResponse>('/notifications', params);
}

export function markNotificationRead(id: string) {
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

export function sendTestNotification(input: SendTestNotificationInput = {}) {
  return api.post<{ accepted: true }>('/notifications/test', input);
}
