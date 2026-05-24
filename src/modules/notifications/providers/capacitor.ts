/**
 * Capacitor local-notifications provider — STUB. Real implementation lands
 * in Track B with `@capacitor/local-notifications` installed in
 * `terminal-mobile/`, plus an Android manifest permission entry and a bridge
 * call. Server-side, this provider is a no-op — the dispatch is performed by
 * the mobile client when it next polls `GET /notifications`.
 *
 * Kept here as a parallel to `web-push.ts` so the dispatch service has a
 * uniform shape across providers.
 */

import type { StoredNotification } from './in-app.js';

export interface CapacitorProvider {
  isReady(): boolean;
  dispatch(userId: string, notif: StoredNotification): Promise<void>;
}

const stubProvider: CapacitorProvider = {
  isReady: () => false,
  dispatch: async () => {
    // No-op — the terminal-mobile poll already picks up the in-app row.
  },
};

export const capacitorProvider: CapacitorProvider = stubProvider;
