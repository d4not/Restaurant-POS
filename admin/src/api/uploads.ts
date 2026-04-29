import { useAuthStore } from '../store/auth';
import { ApiError } from './client';
import type { ApiEnvelope } from '../types/api';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export interface UploadedImage {
  /** Path the backend serves at, e.g. "/uploads/<uuid>.png". Persist this on
   *  Product.image_url / ProductCategory.image_url verbatim. */
  url: string;
}

/**
 * POST a single image file to /uploads/image as multipart/form-data and
 * return the served URL the backend persists. We bypass the JSON `api`
 * helper because it pre-sets Content-Type, which would clobber the
 * multipart boundary the browser injects.
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const token = useAuthStore.getState().token;
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${API_BASE}/uploads/image`, {
    method: 'POST',
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: form,
  });

  let json: ApiEnvelope<UploadedImage>;
  try {
    json = (await res.json()) as ApiEnvelope<UploadedImage>;
  } catch {
    throw new ApiError({ message: `Invalid JSON (HTTP ${res.status})` }, res.status);
  }

  if (!res.ok || !json.success) {
    if (res.status === 401) useAuthStore.getState().logout();
    throw new ApiError(
      json.error ?? { message: `HTTP ${res.status}` },
      res.status,
    );
  }

  return json.data as UploadedImage;
}

/**
 * Resolve a stored `image_url` to a fully-qualified URL the browser can load.
 * Backend-served paths come back as "/uploads/<uuid>.ext"; pasted external
 * URLs ("https://…") are returned as-is. When VITE_API_URL points at a
 * different origin we rebase relative paths onto that origin so the admin
 * panel works in split-deploy setups.
 */
export function resolveImageUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith('/')) return trimmed; // data: or other schemes; leave as-is
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (!apiUrl) return trimmed;
  // VITE_API_URL is the API root ("https://host/api/v1"); /uploads sits at
  // the host root, so derive the origin from URL().
  try {
    return new URL(trimmed, apiUrl).toString();
  } catch {
    return trimmed;
  }
}
