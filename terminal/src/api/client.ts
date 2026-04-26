import { useSession } from '../store/session';

// Resolve the API base URL. Priority:
//   1. VITE_API_URL — explicit override (build-time env).
//   2. Current page hostname on port 3000 — when the renderer is served over
//      http(s) from a host (Vite dev on the LAN, or a deployed copy), reuse
//      that hostname so a tablet at http://192.168.x.x:5173 talks to the API
//      at http://192.168.x.x:3000 instead of its own localhost.
//   3. localhost:3000 — Electron file:// fallback for the desktop app.
function resolveApiBase(): string {
  const override = import.meta.env.VITE_API_URL;
  if (override) return override;
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return `${window.location.protocol}//${window.location.hostname}:3000/api/v1`;
  }
  return 'http://localhost:3000/api/v1';
}

const API_BASE = resolveApiBase();

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useSession.getState().token;
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Cannot reach the server', 0, 'NETWORK');
  }

  // 204 No Content (and any other empty-body success) has no JSON to parse.
  // Returning undefined keeps callers like deleteTable from blowing up on a
  // successful DELETE that the server signals with 204.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    if (!response.ok) {
      throw new ApiError(`Request failed (${response.status})`, response.status);
    }
    return undefined as T;
  }

  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`Server returned ${response.status}`, response.status);
  }

  if (!response.ok || !payload.success) {
    // 401 with an existing session means the token is stale — wipe it so the
    // app routes back to the PIN screen instead of looping on retries.
    if (response.status === 401 && token) {
      useSession.getState().signOut();
    }
    throw new ApiError(
      payload.error?.message ?? `Request failed (${response.status})`,
      response.status,
      payload.error?.code,
    );
  }
  return payload.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    }),
};
