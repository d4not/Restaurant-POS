import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../store/session';
import { getOpenRegisterForUser } from '../api/registers';

/**
 * Locates the OPEN cash register for the logged-in user. Every order must
 * attach to an open register so this is the gate for the floor/order flow.
 *
 * Short staleTime so the UI notices fast if a cashier closes the shift from
 * another terminal, but long enough that the floor doesn't re-query on every
 * focus. Disabled until a user is present to avoid firing during logout.
 */
export function useOpenRegister() {
  const userId = useSessionStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => getOpenRegisterForUser(userId!),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
}
