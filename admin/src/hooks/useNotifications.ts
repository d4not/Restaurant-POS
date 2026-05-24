import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markNotificationRead,
  type ListNotificationsParams,
  type NotificationListResponse,
} from '../api/notifications';
import { useAuthStore } from '../store/auth';

const KEY = ['notifications'] as const;

export function useNotifications(params?: ListNotificationsParams) {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  const q = useQuery<NotificationListResponse>({
    queryKey: [...KEY, params ?? null],
    queryFn: () => listNotifications(params ?? {}),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!token,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        qc.invalidateQueries({ queryKey: KEY });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [qc]);

  return q;
}

export function useUnreadNotificationCount(): number {
  const { data } = useNotifications();
  return data?.unread_count ?? 0;
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
