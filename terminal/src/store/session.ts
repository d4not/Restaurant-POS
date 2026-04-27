import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { AuthUser } from '../api/auth';
import { getBridge } from '../platform';

interface SessionState {
  token: string | null;
  user: AuthUser | null;
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
  lock: () => void;
  locked: boolean;
  // Set when an in-flight request gets back 401 and the token is wiped — the
  // PIN screen reads this once to surface a "Session expired" toast and then
  // calls `consumeSessionExpired()` to clear it.
  sessionExpired: boolean;
  expireSession: () => void;
  consumeSessionExpired: () => void;
}

// Persist via the platform bridge so mobile uses Capacitor Preferences while
// Electron / web fall through to localStorage. Wrapped with createJSONStorage
// so zustand handles serialisation; the inner adapter is purely async pass-
// through to bridge.storage.
const bridgeStorage: StateStorage = {
  getItem: (key) => getBridge().storage.get(key),
  setItem: (key, value) => getBridge().storage.set(key, value),
  removeItem: (key) => getBridge().storage.remove(key),
};

// `locked` is a UX flag: when true the PIN screen shows but the persisted
// token is still valid, so the user only types their PIN to resume. signOut()
// wipes the token entirely (forces re-auth against the API).
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      locked: false,
      sessionExpired: false,
      signIn: (token, user) =>
        set({ token, user, locked: false, sessionExpired: false }),
      signOut: () =>
        set({ token: null, user: null, locked: false, sessionExpired: false }),
      lock: () => set({ locked: true }),
      expireSession: () =>
        set({ token: null, user: null, locked: false, sessionExpired: true }),
      consumeSessionExpired: () => set({ sessionExpired: false }),
    }),
    {
      name: 'pos-terminal-session',
      storage: createJSONStorage(() => bridgeStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);
