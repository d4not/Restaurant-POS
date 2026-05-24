import { ContentUnit } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

// Multi-source product lookup. The cafe restocks a wide mix of SKUs:
// food/drink (Open Food Facts), cleaning + paper goods (Open Products Facts),
// soaps + lotions (Open Beauty Facts), plus the long tail of generic retail
// items where the only thing on the box is a UPC (UPCItemDB free trial).
//
// Strategy:
//   - The three Open*Facts sources share a response shape and can be queried
//     in parallel — they're free, fast, no auth, no meaningful rate limit.
//   - UPCItemDB has a 100-call/day public quota, so it's only called as a
//     fallback when the Open*Facts trio comes back empty.
//   - Returns ALL non-null candidates so the UI can let the user pick when
//     two sources disagree (e.g. different image quality or unit parsing).

const OFF_PRODUCT  = 'https://world.openfoodfacts.org/api/v2/product';
const OBF_PRODUCT  = 'https://world.openbeautyfacts.org/api/v2/product';
const OPF_PRODUCT  = 'https://world.openproductsfacts.org/api/v2/product';
const OFF_SEARCH   = 'https://world.openfoodfacts.org/cgi/search.pl';
const UPCITEMDB    = 'https://api.upcitemdb.com/prod/trial/lookup';

const TIMEOUT_MS   = 5000;
const USER_AGENT   = 'RestaurantPOS/1.0 (admin)';

export type LookupSource =
  | 'openfoodfacts'
  | 'openbeautyfacts'
  | 'openproductsfacts'
  | 'upcitemdb';

export interface SourcedLookup {
  source: LookupSource;
  // For text-search results we surface the matched product's barcode so the
  // user-facing form can prefill it. For barcode lookups it's redundant.
  barcode: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  content_per_unit: number | null;
  content_unit: ContentUnit | null;
  categories: string[];
}

export interface ExistingSupplyHit {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string;
  active: boolean;
}

export interface BarcodeLookupResult {
  existing: ExistingSupplyHit | null;
  candidates: SourcedLookup[];
}

export interface ExternalSearchResult {
  candidates: SourcedLookup[];
}

// ── Open*Facts shared helpers ─────────────────────────────────────────────

interface OffProduct {
  code?: string;
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

interface OffProductResponse {
  status?: number;
  status_verbose?: string;
  product?: OffProduct;
}

interface OffSearchResponse {
  count?: number;
  products?: OffProduct[];
}

interface UpcItemDbItem {
  ean?: string;
  upc?: string;
  title?: string;
  brand?: string;
  description?: string;
  category?: string;
  size?: string;
  images?: string[];
}

interface UpcItemDbResponse {
  code?: string;
  total?: number;
  items?: UpcItemDbItem[];
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

function normalizeCategories(p: OffProduct): string[] {
  const tags = p.categories_tags ?? [];
  return tags.slice(-3).map((t) => t.replace(/^[a-z]{2,3}:/, '').replace(/-/g, ' '));
}

function offProductToLookup(p: OffProduct, source: LookupSource): SourcedLookup | null {
  const name = pickName(p);
  if (!name) return null;
  const { value, unit } = parseQuantity(p);
  return {
    source,
    barcode: p.code?.trim() || null,
    name,
    brand: p.brands?.split(',')[0]?.trim() || null,
    image_url: pickImage(p),
    content_per_unit: value,
    content_unit: unit,
    categories: normalizeCategories(p),
  };
}

// ── Network primitives ────────────────────────────────────────────────────

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      logger.warn({ url, status: res.status }, `${label} non-OK response`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, `${label} failed`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Per-source fetchers ───────────────────────────────────────────────────

async function fetchOpenFactsProduct(
  base: string,
  barcode: string,
  source: LookupSource,
): Promise<SourcedLookup | null> {
  const url = `${base}/${encodeURIComponent(barcode)}.json`;
  const json = await fetchJson<OffProductResponse>(url, source);
  if (!json || json.status !== 1 || !json.product) return null;
  return offProductToLookup(json.product, source);
}

async function fetchUpcItemDb(barcode: string): Promise<SourcedLookup | null> {
  const url = `${UPCITEMDB}?upc=${encodeURIComponent(barcode)}`;
  const json = await fetchJson<UpcItemDbResponse>(url, 'upcitemdb');
  if (!json || json.code !== 'OK' || !json.items?.length) return null;
  const item = json.items[0];
  if (!item) return null;
  const name = item.title?.trim();
  if (!name) return null;

  // UPCItemDB doesn't structure quantity/unit like OFF, so we attempt the
  // same regex sweep on the size string ("16 oz", "1.5 L", "12 fl oz").
  let value: number | null = null;
  let unit: ContentUnit | null = null;
  if (item.size) {
    const m = item.size.trim().match(/([\d.,]+)\s*([a-zA-Z ]+)/);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (Number.isFinite(v)) value = v;
      unit = mapUnit(m[2]);
    }
  }

  return {
    source: 'upcitemdb',
    barcode: item.ean || item.upc || barcode,
    name,
    brand: item.brand?.trim() || null,
    image_url: item.images?.[0] ?? null,
    content_per_unit: value,
    content_unit: unit,
    categories: item.category ? [item.category] : [],
  };
}

// ── Dedupe ────────────────────────────────────────────────────────────────

// A single physical product can land in two Open*Facts databases (e.g. food
// and beauty for some hybrid items). Collapse near-duplicates so the picker
// doesn't show the user three rows of the same milk carton.
function dedupe(candidates: SourcedLookup[]): SourcedLookup[] {
  const seen = new Set<string>();
  const out: SourcedLookup[] = [];
  for (const c of candidates) {
    const key = `${c.name.toLowerCase()}|${(c.brand ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  const trimmed = barcode.trim();

  // Local DB takes precedence — surface the existing supply and skip the
  // external calls entirely so the UI can offer "edit existing" instead of
  // dropping the user into a duplicate-create form.
  const existing = await prisma.supply.findFirst({
    where: { barcode: trimmed, deleted_at: null },
    select: { id: true, name: true, barcode: true, category_id: true, active: true },
  });
  if (existing) return { existing, candidates: [] };

  // Hit the three Open*Facts sources in parallel — their combined latency is
  // the slowest single call instead of the sum.
  const [off, obf, opf] = await Promise.all([
    fetchOpenFactsProduct(OFF_PRODUCT, trimmed, 'openfoodfacts'),
    fetchOpenFactsProduct(OBF_PRODUCT, trimmed, 'openbeautyfacts'),
    fetchOpenFactsProduct(OPF_PRODUCT, trimmed, 'openproductsfacts'),
  ]);

  let candidates = [off, obf, opf].filter((c): c is SourcedLookup => c !== null);

  // Only spend a UPCItemDB call when nothing in the OFF galaxy matched —
  // free trial is 100 calls/day per IP and we want to keep that for genuine
  // long-tail items (cups, paper, hardware).
  if (candidates.length === 0) {
    const upc = await fetchUpcItemDb(trimmed);
    if (upc) candidates.push(upc);
  }

  candidates = dedupe(candidates);
  return { existing: null, candidates };
}

// Search by free-text name. Uses OFF's cgi/search.pl which returns the same
// product shape we already normalize. We don't fan out to OBF/OPF here:
// search-by-name is mostly a fallback when the user is restocking food and
// can't find a barcode, so the food catalog is by far the most useful.
export async function searchByName(
  query: string,
  limit = 10,
): Promise<ExternalSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { candidates: [] };

  const url =
    `${OFF_SEARCH}?` +
    `search_terms=${encodeURIComponent(trimmed)}` +
    `&search_simple=1&action=process&json=1` +
    `&page_size=${Math.max(1, Math.min(limit, 25))}` +
    // Ask only for the fields we use — much smaller payload.
    `&fields=code,product_name,product_name_en,product_name_es,generic_name,` +
    `brands,image_front_url,image_url,image_small_url,product_quantity,` +
    `product_quantity_unit,quantity,categories_tags`;

  const json = await fetchJson<OffSearchResponse>(url, 'openfoodfacts:search');
  if (!json?.products?.length) return { candidates: [] };

  const candidates = json.products
    .map((p) => offProductToLookup(p, 'openfoodfacts'))
    .filter((c): c is SourcedLookup => c !== null);

  return { candidates: dedupe(candidates) };
}
