import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types/api';

interface SessionState {
  token: string | null;
  user: User | null;
  // The default screen the user was sent to after login. Persisted so a
  // refresh / re-launch lands them on the same page rather than bouncing
  // through the role default again.
  setSession: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
      isAuthenticated: () => Boolean(get().token),
    }),
    {
      name: 'pos-terminal-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);

// Map roles → default landing screen. WAITER lands on the floor plan, every
// other operational role lands on the active orders list. Kept here so both
// the post-login redirect and the reload-protected route resolve to the same
// path without duplicating the rule.
export function defaultPathForRole(role: User['role']): string {
  switch (role) {
    case 'WAITER':
      return '/floor';
    case 'CASHIER':
    case 'ADMIN':
    case 'MANAGER':
    case 'BARISTA':
    default:
      return '/orders';
  }
}

// Central role-capability table. Keep UI and code paths pointed at these
// helpers so a future role change is one edit — not a grep across every page.
export const ROLE_CAN_DELETE_ITEMS: User['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];
export const ROLE_CAN_PAY: User['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];
export const ROLE_CAN_CANCEL: User['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];
export const ROLE_CAN_RUN_REGISTER: User['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];
export const ROLE_CAN_RESOLVE_ATTENTION: User['role'][] = ['CASHIER', 'MANAGER', 'ADMIN'];
// Writers: can build a ticket but not necessarily cash it out. BARISTA is
// read-only — they watch the kitchen queue.
export const ROLE_CAN_WRITE_ORDER: User['role'][] = [
  'WAITER',
  'CASHIER',
  'MANAGER',
  'ADMIN',
];
export const ROLE_IS_READ_ONLY: User['role'][] = ['BARISTA'];

export function hasRole(
  user: User | null,
  allowed: readonly User['role'][],
): boolean {
  if (!user) return false;
  return allowed.includes(user.role);
}
