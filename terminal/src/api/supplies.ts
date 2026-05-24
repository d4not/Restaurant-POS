import { api } from './client';
import type { PageResult } from './pagination';

// Mirror of the backend's NormalizedLookup (Open Food Facts)
export interface SupplyBarcodeLookup {
  name: string;
  brand: string | null;
  image_url: string | null;
  content_per_unit: number | null;
  content_unit: 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ' | null;
  categories: string[];
  source: 'openfoodfacts';
}

// Local hit when the supply is already registered (preferred path — has stock).
export interface SupplyBarcodeExisting {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string;
  active: boolean;
}

export interface SupplyBarcodeResult {
  existing: SupplyBarcodeExisting | null;
  lookup: SupplyBarcodeLookup | null;
}

export function lookupSupplyByBarcode(barcode: string): Promise<SupplyBarcodeResult> {
  return api.get<SupplyBarcodeResult>(
    `/supplies/barcode-lookup/${encodeURIComponent(barcode)}`,
  );
}

export interface SupplySummary {
  id: string;
  name: string;
  base_unit: string;
  content_per_unit: string | null;
  content_unit: string | null;
  barcode: string | null;
  active: boolean;
}

// Single supply by id — used to resolve the local supply for a scanned barcode
// when the lookup returns `existing` (we still want the unit + display name).
export function getSupply(id: string): Promise<SupplySummary> {
  return api.get<SupplySummary>(`/supplies/${id}`);
}

// Active-supplies listing for the waste / employee-perk pickers. Most cafés
// have well under 100 supplies, so we drain pages once and let the modal
// filter client-side instead of round-tripping per keystroke.
export async function fetchAllSupplies(): Promise<SupplySummary[]> {
  const out: SupplySummary[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page: PageResult<SupplySummary> = await api.get<PageResult<SupplySummary>>(
      `/supplies?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// Search-by-name result. We trim the payload to the columns we render in the
// autocomplete dropdown — the listing endpoint returns category + tare-weight
// joins we don't need on the wire.
export interface SupplySearchResult {
  id: string;
  name: string;
  barcode: string | null;
  base_unit: string;
  content_per_unit: string | null;
  content_unit: string | null;
  active: boolean;
}

// Server-side name/barcode search (case-insensitive `contains`). Limit is
// capped well below 100 so the dropdown stays scrollable rather than huge.
export async function searchSupplies(
  search: string,
  limit = 12,
): Promise<SupplySearchResult[]> {
  const trimmed = search.trim();
  if (!trimmed) return [];
  const sp = new URLSearchParams();
  sp.set('search', trimmed);
  sp.set('active', 'true');
  sp.set('limit', String(Math.max(1, Math.min(50, limit))));
  const page = await api.get<PageResult<SupplySearchResult>>(`/supplies?${sp.toString()}`);
  return page.items;
}
