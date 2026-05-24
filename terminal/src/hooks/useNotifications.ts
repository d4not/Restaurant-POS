import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markNotificationRead,
  type ListNotificationsParams,
  type NotificationListResponse,
} from '../api/notifications';
import { useSession } from '../store/session';

const NOTIFICATIONS_KEY = ['notifications'] as const;

/**
 * Bell-list query. Polls every 30s and refetches on tab visibility change so a
 * tablet that's been backgrounded for a while still surfaces fresh events
 * promptly. Disabled when the operator isn't signed in — no need to spam the
 * PIN screen with 401s.
 */
export function useNotifications(params?: ListNotificationsParams) {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  const q = useQuery<NotificationListResponse>({
    queryKey: [...NOTIFICATIONS_KEY, params ?? null],
    queryFn: () => listNotifications(params),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!token,
    staleTime: 10_000,
  });

  // Refetch when the tab/window becomes visible — a manager who unlocks the
  // tablet after lunch should see the lunch-rush shortages without waiting
  // up to 30s for the next poll.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [qc]);

  return q;
}

/** Convenience hook — just the unread count, for badges. */
export function useUnreadNotificationCount(): number {
  const { data } = useNotifications();
  return data?.unread_count ?? 0;
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
