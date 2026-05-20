// Remembers the last-used source/destination storages for the transfer flow
// so operators don't re-pick the same pair every time (typical setup is one
// dominant direction, e.g. Warehouse → Bar). Persists through the platform
// bridge so desktop hits localStorage and tablet hits Capacitor Preferences.

import { getBridge } from '../platform';

const KEY = 'pos-terminal-transfer-defaults';

export interface TransferDefaults {
  fromId: string;
  toId: string;
}

export async function loadTransferDefaults(): Promise<TransferDefaults | null> {
  try {
    const raw = await getBridge().storage.get(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransferDefaults>;
    if (typeof parsed.fromId !== 'string' || typeof parsed.toId !== 'string') return null;
    if (!parsed.fromId || !parsed.toId) return null;
    return { fromId: parsed.fromId, toId: parsed.toId };
  } catch {
    return null;
  }
}

export async function saveTransferDefaults(defaults: TransferDefaults): Promise<void> {
  try {
    await getBridge().storage.set(KEY, JSON.stringify(defaults));
  } catch {
    // Best-effort; if storage is unavailable the flow still works, just
    // without prefilled defaults next time.
  }
}
