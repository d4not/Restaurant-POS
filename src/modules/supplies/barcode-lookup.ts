import { ContentUnit } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

// Open Food Facts public API. No auth, no rate limits worth caring about for a
// single-cafe deployment. Free, community-maintained, biggest barcode catalog
// for food/beverage SKUs — which is most of what a cafe restocks. Non-food
// items (cups, napkins) generally won't be found and the form falls back to
// blank manual entry.
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_TIMEOUT_MS = 5000;
const OFF_USER_AGENT = 'RestaurantPOS/1.0 (admin)';

interface OffProduct {
  product_name?: string;
  product_name_en?: string;
  product_name_es?: string;
  generic_name?: string;
  brands?: string;
  image_front_url?: string;
  image_url?: string;
  image_small_url?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  quantity?: string;
  categories?: string;
  categories_tags?: string[];
}

interface OffResponse {
  status?: number;
  status_verbose?: string;
  product?: OffProduct;
}

export interface ExistingSupplyHit {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string;
  active: boolean;
}

export interface NormalizedLookup {
  name: string;
  brand: string | null;
  image_url: string | null;
  content_per_unit: number | null;
  content_unit: ContentUnit | null;
  categories: string[];
  source: 'openfoodfacts';
}

export interface BarcodeLookupResult {
  existing: ExistingSupplyHit | null;
  lookup: NormalizedLookup | null;
}

function pickName(p: OffProduct): string | null {
  const candidates = [p.product_name, p.product_name_en, p.product_name_es, p.generic_name];
  for (const c of candidates) {
    const trimmed = c?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function pickImage(p: OffProduct): string | null {
  return p.image_front_url || p.image_url || p.image_small_url || null;
}

// Map a free-form unit string (as it appears in OFF) onto our ContentUnit
// enum. Anything we don't recognize returns null — the user fills it in
// manually rather than us guessing wrong (e.g. "pcs" → ?).
function mapUnit(raw: string | undefined): ContentUnit | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  switch (lower) {
    case 'ml':
      return ContentUnit.ML;
    case 'l':
    case 'lt':
    case 'litre':
    case 'liter':
      return ContentUnit.L;
    case 'g':
    case 'gr':
    case 'gram':
    case 'grams':
      return ContentUnit.G;
    case 'kg':
      return ContentUnit.KG;
    case 'oz':
      return ContentUnit.OZ;
    case 'fl oz':
    case 'fl_oz':
    case 'floz':
      return ContentUnit.FL_OZ;
    default:
      return null;
  }
}

function parseQuantity(p: OffProduct): { value: number | null; unit: ContentUnit | null } {
  let value: number | null = null;
  let unit: ContentUnit | null = mapUnit(p.product_quantity_unit);

  if (typeof p.product_quantity === 'number' && Number.isFinite(p.product_quantity)) {
    value = p.product_quantity;
  } else if (typeof p.product_quantity === 'string') {
    const n = Number(p.product_quantity);
    if (Number.isFinite(n)) value = n;
  }

  // Fallback: scrape "400 g", "1.5 L", "12 oz" out of the free-text quantity.
  if (value === null || unit === null) {
    const m = (p.quantity ?? '').trim().match(/^([\d.,]+)\s*([a-zA-Z ]+)$/);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (Number.isFinite(v)) {
        value = value ?? v;
        unit = unit ?? mapUnit(m[2]);
      }
    }
  }

  return { value, unit };
}

// categories_tags looks like ["en:dairies", "en:milk", "en:whole-milk"]. Keep
// the last 3 (most specific) and clean them up so the UI can render breadcrumbs.
function normalizeCategories(p: OffProduct): string[] {
  const tags = p.categories_tags ?? [];
  return tags.slice(-3).map((t) =>
    t.replace(/^[a-z]{2,3}:/, '').replace(/-/g, ' '),
  );
}

async function fetchOpenFoodFacts(barcode: string): Promise<NormalizedLookup | null> {
  const url = `${OFF_BASE}/${encodeURIComponent(barcode)}.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      logger.warn({ barcode, status: res.status }, 'OFF lookup non-OK response');
      return null;
    }
    const json = (await res.json()) as OffResponse;
    if (!json || json.status !== 1 || !json.product) return null;

    const name = pickName(json.product);
    if (!name) return null;

    const { value, unit } = parseQuantity(json.product);
    return {
      name,
      brand: json.product.brands?.split(',')[0]?.trim() || null,
      image_url: pickImage(json.product),
      content_per_unit: value,
      content_unit: unit,
      categories: normalizeCategories(json.product),
      source: 'openfoodfacts',
    };
  } catch (err) {
    // Network blip or timeout — just degrade to manual entry.
    logger.warn({ barcode, err: (err as Error).message }, 'OFF lookup failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  const trimmed = barcode.trim();

  // Local DB takes precedence: if we already track this barcode, surface that
  // and skip the external call entirely. The UI can offer "edit existing"
  // instead of dropping the user into a duplicate-create form.
  const existing = await prisma.supply.findFirst({
    where: { barcode: trimmed, deleted_at: null },
    select: { id: true, name: true, barcode: true, category_id: true, active: true },
  });
  if (existing) return { existing, lookup: null };

  const lookup = await fetchOpenFoodFacts(trimmed);
  return { existing: null, lookup };
}
