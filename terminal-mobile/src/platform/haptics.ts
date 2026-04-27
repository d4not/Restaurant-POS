// Light haptic feedback for tablet UI affordances. The three verbs map to
// distinct Capacitor primitives so the device's haptic engine plays a
// recognisable pattern (short tap on a button vs. success buzz on payment).
// All calls are fire-and-forget — failures (e.g. emulator without a haptic
// motor) are swallowed so they never block UI.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function tap(): void {
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
    /* no haptic motor or permission denied */
  });
}

export function success(): void {
  Haptics.notification({ type: NotificationType.Success }).catch(() => {
    /* ignore */
  });
}

export function error(): void {
  Haptics.notification({ type: NotificationType.Error }).catch(() => {
    /* ignore */
  });
}
