import { useMemo } from 'react';
import { getBridge } from '../platform';

interface Haptics {
  tap(): void;
  success(): void;
  error(): void;
}

// Thin wrapper around the platform bridge's haptics — Capacitor plays a real
// pattern on Android, Electron's adapter is a no-op. Memoised so consumers
// can list it in a useEffect dep array without retriggering on every render.
export function useHaptics(): Haptics {
  return useMemo<Haptics>(
    () => ({
      tap: () => getBridge().haptics.tap(),
      success: () => getBridge().haptics.success(),
      error: () => getBridge().haptics.error(),
    }),
    [],
  );
}
