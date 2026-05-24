import { api, ApiError } from './client';
import type { ApiEnvelope, LoginResponse, User } from '../types/api';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

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

// Resolve the current user from an explicit bearer token. Used by the POS
// terminal → admin handoff: the terminal pops this app with ?token=<jwt>, we
// hit /auth/me to hydrate the user record, then store the session as if the
// operator had filled in the email/password form. Bypasses the shared client
// helper because that one pulls the token from the auth store, which is empty
// at the moment we need to verify the handoff token.
export async function fetchMeWithToken(token: string): Promise<User> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  let json: ApiEnvelope<User>;
  try {
    json = (await res.json()) as ApiEnvelope<User>;
  } catch {
    throw new ApiError({ message: `Invalid JSON (HTTP ${res.status})` }, res.status);
  }
  if (!res.ok || !json.success) {
    throw new ApiError(json.error ?? { message: `HTTP ${res.status}` }, res.status);
  }
  return json.data as User;
}
