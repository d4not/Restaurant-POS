import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesState {
  // Minutes of inactivity before the auto-lock kicks in. 0 disables auto-lock.
  // Persisted per-device — every cashier on this terminal shares the same value.
  idleLockMinutes: number;
  setIdleLockMinutes: (value: number) => void;
}

const DEFAULT_IDLE = 5;

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      idleLockMinutes: DEFAULT_IDLE,
      setIdleLockMinutes: (value) => {
        // Clamp to a sane range (0 = off; max 60 to avoid "set 24h" footguns).
        const clamped = Math.max(0, Math.min(60, Math.round(value)));
        set({ idleLockMinutes: clamped });
      },
    }),
    { name: 'pos-terminal-preferences' },
  ),
);
