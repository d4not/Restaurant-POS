// Client-side unit conversion that mirrors src/modules/recipes/cost-engine.ts.
// Kept tiny + pure (no Decimal lib) because waste UX only needs friendly live
// previews — the backend re-does the math authoritatively when saving.
//
// Volume canonical = ML, weight canonical = G. Cross-family conversion is
// rejected because it would require density.

export type ContentUnit = 'ML' | 'L' | 'FL_OZ' | 'G' | 'KG' | 'OZ';

const VOLUME_TO_ML: Record<string, number> = {
  ML: 1,
  L: 1000,
  FL_OZ: 29.5735,
};
const WEIGHT_TO_G: Record<string, number> = {
  G: 1,
  KG: 1000,
  OZ: 28.3495,
};

function isVolume(u: string): boolean {
  return u in VOLUME_TO_ML;
}
function isWeight(u: string): boolean {
  return u in WEIGHT_TO_G;
}

export function convertContentQuantity(
  qty: number,
  from: ContentUnit | string,
  to: ContentUnit | string,
): number {
  if (from === to) return qty;
  if (isVolume(from) && isVolume(to)) {
    return (qty * VOLUME_TO_ML[from]!) / VOLUME_TO_ML[to]!;
  }
  if (isWeight(from) && isWeight(to)) {
    return (qty * WEIGHT_TO_G[from]!) / WEIGHT_TO_G[to]!;
  }
  throw new Error(`Cannot convert ${from} → ${to} (different families)`);
}

/**
 * Convert a quantity expressed in the supply's content_unit (e.g. ML) into the
 * supply's base unit (e.g. BOTTLE), given the bottle's content_per_unit.
 * Example: 30 ml of a 700-ml bottle → 30/700 = 0.0429 bottles.
 */
export function contentToBase(
  qty: number,
  contentUnit: ContentUnit | string | null,
  contentPerUnit: number | string | null,
): number {
  if (!Number.isFinite(qty)) return 0;
  const cpu = contentPerUnit == null ? null : Number(contentPerUnit);
  if (cpu == null || !Number.isFinite(cpu) || cpu <= 0 || contentUnit == null) {
    // Piece-type supplies — caller already gave us base-unit qty.
    return qty;
  }
  return qty / cpu;
}

/**
 * Inverse of `contentToBase`. Example: 0.04 bottles × 700 ml/bottle = 28 ml.
 */
export function baseToContent(
  qty: number,
  contentUnit: ContentUnit | string | null,
  contentPerUnit: number | string | null,
): number {
  if (!Number.isFinite(qty)) return 0;
  const cpu = contentPerUnit == null ? null : Number(contentPerUnit);
  if (cpu == null || !Number.isFinite(cpu) || cpu <= 0 || contentUnit == null) {
    return qty;
  }
  return qty * cpu;
}

/**
 * Format a numeric quantity for human display, trimming trailing zeros while
 * keeping enough significant digits for the small fractions waste produces
 * (e.g., 0.043 bottle).
 */
export function formatQty(value: number, maxDecimals = 4): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, '');
}
