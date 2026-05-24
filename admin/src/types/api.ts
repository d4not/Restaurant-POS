/**
 * Shared types that match the backend's standard envelope.
 * All endpoints return `{ success: boolean, data?, error? }`.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

export interface ApiErrorPayload {
  message: string;
  code?: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string | null;
}

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}
