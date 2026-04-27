import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesState {
  // Minutes of inactivity before the auto-lock kicks in. 0 disables auto-lock.
  // Persisted per-device — every cashier on this terminal shares the same value.
  idleLockMinutes: number;
  setIdleLockMinutes: (value: number) => void;
  // Global UI scale as a fraction (1 = 100%). Drives the --ui-scale CSS var
  // that the design tokens cascade off. Persisted per-device because the
  // ergonomics of a 7" tablet vs. a 13" tablet are very different and the
  // operator should be able to tune it once and forget.
  uiScale: number;
  setUiScale: (value: number) => void;
}

const DEFAULT_IDLE = 5;
const DEFAULT_UI_SCALE = 1;

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      idleLockMinutes: DEFAULT_IDLE,
      setIdleLockMinutes: (value) => {
        // Clamp to a sane range (0 = off; max 60 to avoid "set 24h" footguns).
        const clamped = Math.max(0, Math.min(60, Math.round(value)));
        set({ idleLockMinutes: clamped });
      },
      uiScale: DEFAULT_UI_SCALE,
      setUiScale: (value) => {
        // Round to the nearest 0.05 so the persisted value matches the option
        // the user actually picked (avoids 0.9000000001 noise on reload). Floor
        // 0.7 keeps tap targets readable; cap 1.4 stops elements from breaking
        // the tablet's vertical budget.
        const stepped = Math.round(value * 20) / 20;
        const clamped = Math.max(0.7, Math.min(1.4, stepped));
        set({ uiScale: clamped });
      },
    }),
    { name: 'pos-terminal-preferences' },
  ),
);
