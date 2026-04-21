import { Prisma } from '@prisma/client';

// Single source of truth for Decimal: Prisma's runtime Decimal is API-compatible
// with decimal.js and accepted directly by every Decimal column in the schema.
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export type DecimalInput = Prisma.Decimal | string | number;

export const DECIMAL_ZERO = new Decimal(0);

export function toDecimal(value: DecimalInput): Decimal {
  return value instanceof Prisma.Decimal ? value : new Decimal(value);
}

/**
 * Weighted Average Cost.
 *
 *   new_avg = ((old_stock * old_avg) + (new_qty * new_cost)) / (old_stock + new_qty)
 *
 * When the combined stock is zero (e.g. reversing out to empty) the average is
 * undefined; we return zero so downstream consumers don't divide by zero.
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
  const totalStock = stock.add(qty);
  if (totalStock.isZero()) return new Decimal(0);
  return stock.mul(avg).add(qty.mul(cost)).div(totalStock);
}
