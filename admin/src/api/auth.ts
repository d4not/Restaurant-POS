import { api } from './client';
import type { LoginResponse } from '../types/api';

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Phase 6 (auth) is still a backend placeholder. The endpoint shape is
 * reserved here so the UI works as soon as the server ships it.
 */
export function login(payload: LoginPayload): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/login', payload);
}
