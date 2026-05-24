import { api } from './client';
import type { PageResult } from './pagination';

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_days: number;
  notes: string | null;
  active: boolean;
}

// PATCH /suppliers/:id payload. All fields optional; pass null to clear an
// optional string. Mirrors src/modules/suppliers/schema.ts.
export interface SupplierWriteInput {
  name?: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  credit_days?: number;
  notes?: string | null;
  active?: boolean;
}

// POST /suppliers payload. The backend rejects empty optional strings (Zod
// .min(1)), so callers pre-trim and either drop the key or pass undefined.
export interface CreateSupplierInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  credit_days?: number;
  notes?: string;
}

// Drains active suppliers in one go — there are rarely more than a few dozen
// per café, and the dropdown wants the full list anyway.
export async function listSuppliers(
  params: { active?: boolean } = {},
): Promise<Supplier[]> {
  const out: Supplier[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (params.active !== undefined) sp.set('active', String(params.active));
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<Supplier>>(`/suppliers?${sp.toString()}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

export function getSupplier(id: string): Promise<Supplier> {
  return api.get<Supplier>(`/suppliers/${id}`);
}

export function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  return api.post<Supplier>('/suppliers', input);
}

export function updateSupplier(
  id: string,
  input: SupplierWriteInput,
): Promise<Supplier> {
  return api.patch<Supplier>(`/suppliers/${id}`, input);
}

// Soft delete — backend sets active=false and preserves historical references
// from purchases/packagings. Use updateSupplier({active:true}) to revive.
export async function deleteSupplier(id: string): Promise<void> {
  await api.delete(`/suppliers/${id}`);
}
