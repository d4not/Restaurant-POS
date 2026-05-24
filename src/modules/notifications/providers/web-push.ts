/**
 * Web Push provider — STUB. Real implementation lands in Track B:
 *   - VAPID keys provisioned in .env (`WEB_PUSH_VAPID_PUBLIC`, `_PRIVATE`)
 *   - `web-push` npm package installed
 *   - `PushSubscription` Prisma table (admin web stores its endpoint here)
 *   - `subscribe` endpoint on this module
 *   - `dispatchWebPush` actually marshals & sends
 *
 * Today this exists so the dispatch service can call `dispatchWebPush()`
 * unconditionally — no-op if the provider isn't ready. The contract here
 * doesn't change when the real implementation arrives.
 */

import type { StoredNotification } from './in-app.js';

export interface WebPushProvider {
  isReady(): boolean;
  dispatch(userId: string, notif: StoredNotification): Promise<void>;
}

const stubProvider: WebPushProvider = {
  isReady: () => false,
  dispatch: async () => {
    // No-op until Track B wires VAPID + subscription storage.
  },
};

export const webPushProvider: WebPushProvider = stubProvider;
