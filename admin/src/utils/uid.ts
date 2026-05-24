// crypto.randomUUID() requires a secure context (HTTPS or localhost). When
// the admin is opened from another machine over plain HTTP it's undefined.
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
