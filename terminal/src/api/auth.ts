import { api } from './client';

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export function pinLogin(pin: string): Promise<LoginResult> {
  return api.post<LoginResult>('/auth/pin-login', { pin });
}

export function fetchMe(): Promise<AuthUser> {
  return api.get<AuthUser>('/auth/me');
}

export interface VerifyPinResult {
  ok: true;
  approver: AuthUser;
}

// Step-up auth — caller is already authenticated via JWT but the UI wants a
// fresh PIN check before unlocking a destructive screen or letting a cashier
// approve a waiter's action.
//   - 'self' verifies the current user's PIN
//   - 'cashier' verifies *any* active CASHIER/MANAGER/ADMIN PIN, returning
//     the matching user as the approver
export function verifyPin(pin: string, mode: 'self' | 'cashier' = 'self'): Promise<VerifyPinResult> {
  return api.post<VerifyPinResult>('/auth/verify-pin', { pin, mode });
}
