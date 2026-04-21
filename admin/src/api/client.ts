import { useAuthStore } from '../store/auth';
import type { ApiEnvelope, ApiErrorPayload } from '../types/api';

// Default is same-origin `/api/v1` so the Vite dev proxy (or a production reverse
// proxy) hands the request to the Express backend. Override with VITE_API_URL
// for split-origin deployments.
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export class ApiError extends Error {
  public readonly code?: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message || 'Request failed');
    this.name = 'ApiError';
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = `${API_BASE}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const token = useAuthStore.getState().token;

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 204 / empty body
  if (res.status === 204) {
    return undefined as T;
  }

  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError({ message: `Invalid JSON (HTTP ${res.status})` }, res.status);
  }

  if (!res.ok || !json.success) {
    // 401 → force logout so the router bounces the user to /login.
    if (res.status === 401) {
      useAuthStore.getState().logout();
    }
    throw new ApiError(
      json.error ?? { message: `HTTP ${res.status}` },
      res.status,
    );
  }

  return json.data as T;
}

export const api = {
  get:    <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),
  post:   <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'POST', body, query }),
  put:    <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body }),
  patch:  <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};
