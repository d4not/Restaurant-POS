import { describe, it, expect } from 'vitest';
import { Decimal } from '../../src/lib/decimal.js';
import {
  computeSupplyItemCost,
  computePreparationItemCost,
  convertQuantity,
} from '../../src/modules/recipes/cost-engine.js';

// These tests exercise the pure math of the cost engine without touching the
// DB. They anchor the formula in the spec against the Latte example before
// we rely on it through the full API surface in the integration tests.

describe('convertQuantity', () => {
  it('returns quantity unchanged when units match', () => {
    expect(convertQuantity('200', 'ML', 'ML').toString()).toBe('200');
  });

  it('converts L → ML (× 1000)', () => {
    expect(convertQuantity('1.5', 'L', 'ML').toString()).toBe('1500');
  });

  it('converts ML → L (/ 1000)', () => {
    expect(convertQuantity('250', 'ML', 'L').toString()).toBe('0.25');
  });

  it('converts KG → G (× 1000)', () => {
    expect(convertQuantity('0.5', 'KG', 'G').toString()).toBe('500');
  });

  it('converts G → KG (/ 1000)', () => {
    expect(convertQuantity('18', 'G', 'KG').toString()).toBe('0.018');
  });

  it('refuses to cross measurement families (ml → g)', () => {
    expect(() => convertQuantity('100', 'ML', 'G')).toThrow(
      /different measurement families/,
    );
  });
});

describe('computeSupplyItemCost', () => {
  it('Latte milk line: 200ml of a 946ml bottle @ $30.00 → 634.2495 centavos', () => {
    // 200 / 946 bottles = 0.21141649...
    // cost = 0.21141649... * 3000 centavos
    const cost = computeSupplyItemCost(200, 'ml', 0, {
      content_per_unit: new Decimal(946),
      content_unit: 'ML',
      average_cost: new Decimal(3000),
    });
    // Exact expected: 200 * 3000 / 946 = 600000 / 946
    const expected = new Decimal(600000).div(946);
    expect(cost.toString()).toBe(expected.toString());
  });

  it('Latte espresso line: 18g from a 1kg bag @ $400.00 → 720 centavos', () => {
    // Bag of 1000g, so 18g = 0.018 bags. 0.018 * 40000 = 720.
    const cost = computeSupplyItemCost(18, 'g', 0, {
      content_per_unit: new Decimal(1000),
      content_unit: 'G',
      average_cost: new Decimal(40000),
    });
    expect(cost.toString()).toBe('720');
  });

  it('applies waste_pct correctly (5% waste on 18g espresso)', () => {
    // baseQty = 18/1000 = 0.018
    // adjusted = 0.018 / (1 - 0.05) = 0.018 / 0.95 = 0.01894736...
    // cost = 0.01894736... * 40000 = 757.894736...
    const cost = computeSupplyItemCost(18, 'g', 5, {
      content_per_unit: new Decimal(1000),
      content_unit: 'G',
      average_cost: new Decimal(40000),
    });
    const expected = new Decimal(18).div(1000).div(new Decimal('0.95')).mul(40000);
    expect(cost.toString()).toBe(expected.toString());
  });

  it('handles cross-unit conversion (recipe in g, supply content_unit kg)', () => {
    // Supply: 1-BAG, content_per_unit = 1 kg. Recipe uses 250g.
    // 250g → 0.25 kg → 0.25 / 1 = 0.25 bags → 0.25 * 4000 = 1000
    const cost = computeSupplyItemCost(250, 'g', 0, {
      content_per_unit: new Decimal(1),
      content_unit: 'KG',
      average_cost: new Decimal(4000),
    });
    expect(cost.toString()).toBe('1000');
  });

  it('handles piece-type supplies (no content_per_unit)', () => {
    // A cup costs 150 centavos and a recipe needs 1 cup.
    const cost = computeSupplyItemCost(1, 'piece', 0, {
      content_per_unit: null,
      content_unit: null,
      average_cost: new Decimal(150),
    });
    expect(cost.toString()).toBe('150');
  });

  it('rejects piece unit on a measurable supply', () => {
    expect(() =>
      computeSupplyItemCost(1, 'piece', 0, {
        content_per_unit: new Decimal(946),
        content_unit: 'ML',
        average_cost: new Decimal(3000),
      }),
    ).toThrow(/incompatible/);
  });

  it('rejects a measurable recipe unit on a piece-type supply', () => {
    expect(() =>
      computeSupplyItemCost(10, 'ml', 0, {
        content_per_unit: null,
        content_unit: null,
        average_cost: new Decimal(150),
      }),
    ).toThrow(/piece\/unit quantity/);
  });

  it('rejects waste_pct >= 100', () => {
    expect(() =>
      computeSupplyItemCost(10, 'ml', 100, {
        content_per_unit: new Decimal(100),
        content_unit: 'ML',
        average_cost: new Decimal(1000),
      }),
    ).toThrow(/less than 100/);
  });
});

describe('computePreparationItemCost', () => {
  it('Latte syrup line: 30ml of a 150ml simple syrup batch costing 200 centavos → 40 centavos', () => {
    const cost = computePreparationItemCost(
      30,
      'ml',
      0,
      { yield_quantity: new Decimal(150), yield_unit: 'ml' },
      new Decimal(200),
    );
    expect(cost.toString()).toBe('40');
  });

  it('converts units between recipe and preparation yield', () => {
    // Recipe uses 0.5 L of a syrup that yields 2 L at 10000 centavos.
    // cost = (0.5/2) * 10000 = 2500
    const cost = computePreparationItemCost(
      0.5,
      'L',
      0,
      { yield_quantity: new Decimal(2), yield_unit: 'L' },
      new Decimal(10000),
    );
    expect(cost.toString()).toBe('2500');
  });

  it('refuses when preparation lacks yield', () => {
    expect(() =>
      computePreparationItemCost(
        30,
        'ml',
        0,
        { yield_quantity: null, yield_unit: null },
        new Decimal(200),
      ),
    ).toThrow(/yield_quantity/);
  });
});
