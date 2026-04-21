import { describe, it, expect } from 'vitest';
import { Decimal, recalculateWAC } from '../../src/lib/decimal.js';
import {
  convertRecipeQuantityToBase,
  computePreparationFactor,
} from '../../src/modules/recipes/cost-engine.js';

// Edge-case guards introduced during the code audit. These cover the
// boundaries the schema validators don't reach: legacy DB rows with
// zero-valued fields, divide-by-zero conditions, and WAC math when a
// previous sale drove stock negative.

describe('recalculateWAC', () => {
  it('returns zero when combined stock is zero', () => {
    const wac = recalculateWAC(0, 5000, 0, 3000);
    expect(wac.toString()).toBe('0');
  });

  it('returns the new unit cost when there is no existing stock', () => {
    // (0 * 0) + (10 * 3000) / (0 + 10) = 3000
    const wac = recalculateWAC(0, 0, 10, 3000);
    expect(wac.toString()).toBe('3000');
  });

  it('blends old and new stock proportionally', () => {
    // (12 * 2800) + (18 * 3000) / 30 = 2920
    const wac = recalculateWAC(12, 2800, 18, 3000);
    expect(wac.toString()).toBe('2920');
  });

  it('clamps negative existing stock to zero so the new WAC equals the new unit cost', () => {
    // A prior sale drove stock to -20 at WAC 5000. A new purchase of 50 @ 3000
    // should not compute ((-20 * 5000) + (50 * 3000)) / 30 = 1666.67 — that
    // would be nonsense. Clamp the historical side to 0 and return 3000.
    const wac = recalculateWAC(-20, 5000, 50, 3000);
    expect(wac.toString()).toBe('3000');
  });

  it('clamps negative stock even when the new purchase is small', () => {
    // (-5 * 4000) + (1 * 2000) / -4  → would go very negative without the clamp.
    // Clamped: (0 * 4000) + (1 * 2000) / 1 = 2000.
    const wac = recalculateWAC(-5, 4000, 1, 2000);
    expect(wac.toString()).toBe('2000');
  });
});

describe('convertRecipeQuantityToBase — edge cases', () => {
  it('rejects a supply with content_per_unit = 0 (legacy / corrupted row)', () => {
    expect(() =>
      convertRecipeQuantityToBase(200, 'ml', 0, {
        content_per_unit: new Decimal(0),
        content_unit: 'ML',
      }),
    ).toThrow(/content_per_unit must be positive/);
  });

  it('rejects a supply with negative content_per_unit', () => {
    expect(() =>
      convertRecipeQuantityToBase(200, 'ml', 0, {
        content_per_unit: new Decimal(-1),
        content_unit: 'ML',
      }),
    ).toThrow(/content_per_unit must be positive/);
  });

  it('still rejects waste_pct = 100 (would be divide-by-zero)', () => {
    expect(() =>
      convertRecipeQuantityToBase(200, 'ml', 100, {
        content_per_unit: new Decimal(946),
        content_unit: 'ML',
      }),
    ).toThrow(/less than 100/);
  });
});

describe('computePreparationFactor — edge cases', () => {
  it('rejects a preparation with yield_quantity = 0', () => {
    expect(() =>
      computePreparationFactor(30, 'ml', 0, {
        yield_quantity: new Decimal(0),
        yield_unit: 'ml',
      }),
    ).toThrow(/yield_quantity must be positive/);
  });

  it('rejects a preparation with negative yield_quantity', () => {
    expect(() =>
      computePreparationFactor(30, 'ml', 0, {
        yield_quantity: new Decimal(-150),
        yield_unit: 'ml',
      }),
    ).toThrow(/yield_quantity must be positive/);
  });

  it('rejects a preparation missing yield_unit when yield_quantity is set', () => {
    expect(() =>
      computePreparationFactor(30, 'ml', 0, {
        yield_quantity: new Decimal(150),
        yield_unit: null,
      }),
    ).toThrow(/yield_quantity/);
  });
});
