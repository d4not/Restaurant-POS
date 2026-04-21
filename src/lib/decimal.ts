import { Prisma } from '@prisma/client';

// Single source of truth for Decimal: Prisma's runtime Decimal is API-compatible
// with decimal.js and accepted directly by every Decimal column in the schema.
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export type DecimalInput = Prisma.Decimal | string | number;

function toDecimal(value: DecimalInput): Decimal {
  return value instanceof Prisma.Decimal ? value : new Decimal(value);
}

/**
 * Weighted Average Cost.
 *
 *   new_avg = ((old_stock * old_avg) + (new_qty * new_cost)) / (old_stock + new_qty)
 *
 * Edge cases:
 *  - Combined stock == 0: average is undefined; return 0 to avoid div-by-zero.
 *  - Old stock < 0: sales can drive stock negative (café must keep operating).
 *    A negative old_stock would pull the weighted average in the wrong
 *    direction — e.g. -20 units @ 5000c + 50 units @ 3000c computes to 1666c
 *    instead of 3000c. Clamp the historical side to 0 so the new purchase's
 *    unit_cost is the new WAC (there's nothing meaningful to average against).
 */
export function recalculateWAC(
  currentStock: DecimalInput,
  currentAvgCost: DecimalInput,
  newQuantity: DecimalInput,
  newUnitCost: DecimalInput,
): Decimal {
  const stock = toDecimal(currentStock);
  const avg = toDecimal(currentAvgCost);
  const qty = toDecimal(newQuantity);
  const cost = toDecimal(newUnitCost);
  const effectiveOldStock = stock.isNegative() ? new Decimal(0) : stock;
  const totalStock = effectiveOldStock.add(qty);
  if (totalStock.isZero()) return new Decimal(0);
  return effectiveOldStock.mul(avg).add(qty.mul(cost)).div(totalStock);
}
