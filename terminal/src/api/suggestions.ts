import { api } from './client';
import type { PageResult } from './pagination';
import type { UserRole } from './auth';

export type SuggestionType =
  | 'TABLE_CREATE'
  | 'TABLE_UPDATE'
  | 'TABLE_DELETE'
  | 'PRODUCT_CREATE'
  | 'PRODUCT_UPDATE'
  | 'PRODUCT_DELETE';

export type SuggestionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SuggestionUserSummary {
  id: string;
  name: string;
  role: UserRole;
}

export interface SuggestionTableSummary {
  id: string;
  number: number;
  label: string | null;
  zone: { id: string; name: string };
}

export interface SuggestionProductSummary {
  id: string;
  name: string;
  type: string;
}

export interface Suggestion {
  id: string;
  type: SuggestionType;
  status: SuggestionStatus;
  payload: Record<string, unknown>;
  note: string | null;
  target_table_id: string | null;
  target_product_id: string | null;
  created_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  creator: SuggestionUserSummary;
  reviewer: SuggestionUserSummary | null;
  table: SuggestionTableSummary | null;
  product: SuggestionProductSummary | null;
}

// Discriminated input type — matches the backend's createSuggestionSchema.
export type CreateSuggestionInput =
  | {
      type: 'TABLE_CREATE';
      payload: Record<string, unknown>;
      note?: string;
    }
  | {
      type: 'TABLE_UPDATE';
      target: { table_id: string };
      payload: Record<string, unknown>;
      note?: string;
    }
  | {
      type: 'TABLE_DELETE';
      target: { table_id: string };
      payload?: Record<string, never>;
      note?: string;
    }
  | {
      type: 'PRODUCT_CREATE';
      payload: Record<string, unknown>;
      note?: string;
    }
  | {
      type: 'PRODUCT_UPDATE';
      target: { product_id: string };
      payload: Record<string, unknown>;
      note?: string;
    }
  | {
      type: 'PRODUCT_DELETE';
      target: { product_id: string };
      payload?: Record<string, never>;
      note?: string;
    };

export interface ListSuggestionsQuery {
  status?: SuggestionStatus;
  type?: SuggestionType;
  cursor?: string;
  limit?: number;
}

export function createSuggestion(input: CreateSuggestionInput): Promise<Suggestion> {
  return api.post<Suggestion>('/suggestions', input);
}

export function listSuggestions(
  query: ListSuggestionsQuery = {},
): Promise<PageResult<Suggestion>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 50));
  return api.get<PageResult<Suggestion>>(`/suggestions?${params.toString()}`);
}

// Admin step-up PIN is required server-side on both approve and reject. The
// reviewNote stays optional; an empty string is stripped so the strict Zod
// schema doesn't reject it.
export function approveSuggestion(
  id: string,
  pin: string,
  reviewNote?: string,
): Promise<Suggestion> {
  const body: Record<string, unknown> = { pin };
  if (reviewNote && reviewNote.trim()) body.review_note = reviewNote.trim();
  return api.post<Suggestion>(`/suggestions/${id}/approve`, body);
}

export function rejectSuggestion(
  id: string,
  pin: string,
  reviewNote?: string,
): Promise<Suggestion> {
  const body: Record<string, unknown> = { pin };
  if (reviewNote && reviewNote.trim()) body.review_note = reviewNote.trim();
  return api.post<Suggestion>(`/suggestions/${id}/reject`, body);
}
