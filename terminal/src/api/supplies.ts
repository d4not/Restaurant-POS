import { api } from './client';

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
