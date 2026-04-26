import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '../api/auth';

interface SessionState {
  token: string | null;
  user: AuthUser | null;
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
  lock: () => void;
  locked: boolean;
}

// `locked` is a UX flag: when true the PIN screen shows but the persisted
// token is still valid, so the user only types their PIN to resume. signOut()
// wipes the token entirely (forces re-auth against the API).
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      locked: false,
      signIn: (token, user) => set({ token, user, locked: false }),
      signOut: () => set({ token: null, user: null, locked: false }),
      lock: () => set({ locked: true }),
    }),
    {
      name: 'pos-terminal-session',
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);
