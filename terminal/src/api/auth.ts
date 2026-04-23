import { api } from './client';
import type { LoginResponse, User } from '../types/api';

export function pinLogin(pin: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/pin-login', { pin });
}

export function getCurrentUser(): Promise<User> {
  return api.get<User>('/auth/me');
}
