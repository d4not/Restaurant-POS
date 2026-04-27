import { describe, it, expect } from 'vitest';
import {
  formatKitchenComanda,
  formatMoney,
  formatReceipt,
  type ComandaInput,
  type ReceiptInput,
} from '../../src/modules/print/formatter.js';

const PRINTED_AT = new Date('2026-04-25T14:35:00');

function comandaInput(overrides: Partial<ComandaInput> = {}): ComandaInput {
  return {
    order_number: 42,
    table_label: 'Table 5',
    waiter_name: 'Carlos',
    printed_at: PRINTED_AT,
    is_correction: false,
    items: [
      {
        quantity: 2,
        product_name: 'Latte',
        variant_name: 'Grande',
        modifiers: ['Almond Milk', 'Extra Shot'],
        notes: 'Extra hot',
        is_new: false,
      },
      {
        quantity: 1,
        product_name: 'Club Sandwich',
        variant_name: null,
        modifiers: [],
        notes: 'No tomato',
        is_new: false,
      },
    ],
    voided_items: [],
    width: 32,
    ...overrides,
  };
}

function receiptInput(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    business_name: 'Cafe POS',
    business_address: '123 Main St',
    order_number: 42,
    date: new Date('2026-04-25T14:52:00'),
    cashier_name: 'Daniel',
    table_label: 'Table 5',
    items: [
      {
        quantity: 2,
        product_name: 'Latte',
        variant_name: 'Grande',
        line_total_centavos: 15000,
        modifiers: [
          { name: 'Almond Milk', extra_price_centavos: 2000 },
          { name: 'Extra Shot', extra_price_centavos: 3000 },
        ],
      },
      {
        quantity: 1,
        product_name: 'Club Sandwich',
        variant_name: null,
        line_total_centavos: 9500,
        modifiers: [],
      },
    ],
    subtotal_centavos: 25431,
    tax_label: 'IVA 16%',
    tax_centavos: 4069,
    discount_centavos: 0,
    total_centavos: 29500,
    payments: [
      { method: 'CASH', amount_centavos: 30000, change_centavos: 500, reference: null },
    ],
    width: 32,
    ...overrides,
  };
}

describe('formatMoney', () => {
  it('formats positive cents as $X.YZ', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(50)).toBe('$0.50');
    expect(formatMoney(150)).toBe('$1.50');
    expect(formatMoney(15000)).toBe('$150.00');
  });

  it('groups thousands with commas', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(1234567)).toBe('$12,345.67');
    expect(formatMoney(12345678)).toBe('$123,456.78');
  });

  it('renders negative amounts with leading minus', () => {
    expect(formatMoney(-150)).toBe('-$1.50');
  });
});

describe('formatKitchenComanda', () => {
  it('emits a header, items, modifiers, notes, and a footer rule', () => {
    const lines = formatKitchenComanda(comandaInput());
    // First and last lines are the heavy '=' rule (32 chars at 58mm).
    expect(lines[0]).toBe('='.repeat(32));
    expect(lines[lines.length - 1]).toBe('='.repeat(32));
    // Title is centered.
    expect(lines[1].trim()).toBe('KITCHEN ORDER');
    // Order number + table on the same row.
    const orderLine = lines.find((l) => l.includes('Order #: 42'));
    expect(orderLine).toBeDefined();
    expect(orderLine!).toContain('Table 5');
    // Waiter + printed time on the same row.
    const waiterLine = lines.find((l) => l.includes('Waiter: Carlos'));
    expect(waiterLine).toBeDefined();
    expect(waiterLine!).toMatch(/\d{2}:\d{2}$/);
    // Item rows include qty prefix and modifiers indented with '>'.
    expect(lines).toContain('2x Latte Grande');
    expect(lines).toContain('   > Almond Milk');
    expect(lines).toContain('   > Extra Shot');
    expect(lines).toContain('   NOTE: Extra hot');
    expect(lines).toContain('1x Club Sandwich');
    expect(lines).toContain('   NOTE: No tomato');
  });

  it('renders a CORRECTION header and [NEW] markers when is_correction is true', () => {
    const lines = formatKitchenComanda(
      comandaInput({
        is_correction: true,
        items: [
          {
            quantity: 1,
            product_name: 'Croissant',
            variant_name: null,
            modifiers: [],
            notes: null,
            is_new: true,
          },
          {
            quantity: 2,
            product_name: 'Latte',
            variant_name: 'Grande',
            modifiers: [],
            notes: null,
            is_new: false,
          },
        ],
      }),
    );
    expect(lines.some((l) => l.includes('KITCHEN CORRECTION'))).toBe(true);
    expect(lines.some((l) => l.includes('Replaces previous ticket'))).toBe(true);
    expect(lines).toContain('1x Croissant [NEW]');
    expect(lines).toContain('2x Latte Grande');
  });

  it('appends a *** REMOVED *** block for voided items', () => {
    const lines = formatKitchenComanda(
      comandaInput({
        voided_items: [
          {
            quantity: 1,
            product_name: 'Mocha',
            variant_name: 'Mediano',
            void_reason: 'wrong size',
          },
        ],
      }),
    );
    expect(lines.some((l) => l.includes('*** REMOVED ***'))).toBe(true);
    expect(lines).toContain('1x Mocha Mediano');
    expect(lines).toContain('   reason: wrong size');
  });

  it('shows a "(no items)" placeholder when both lists are empty', () => {
    const lines = formatKitchenComanda(
      comandaInput({ items: [], voided_items: [] }),
    );
    expect(lines.some((l) => l.includes('(no items)'))).toBe(true);
  });

  it('omits the table label for null (e.g. unseated takeout)', () => {
    const lines = formatKitchenComanda(comandaInput({ table_label: null }));
    const orderLine = lines.find((l) => l.startsWith('Order #'))!;
    // No "Table" / "Takeout" suffix when label is null.
    expect(orderLine).not.toMatch(/Table|Takeout/);
  });
});

describe('formatReceipt', () => {
  it('renders business header, item lines with right-aligned prices, totals, and payments', () => {
    const lines = formatReceipt(receiptInput());

    // Heavy '=' rules bookend the slip.
    expect(lines[0]).toBe('='.repeat(32));
    // Business name is centered up top.
    expect(lines[1].trim()).toBe('Cafe POS');
    expect(lines[2].trim()).toBe('123 Main St');

    expect(lines).toContain(`Order #: 42`);
    expect(lines.some((l) => l.startsWith('Date: 2026-04-25'))).toBe(true);

    // Item row: "2  Latte Grande" on the left, "$150.00" on the right.
    const latteLine = lines.find((l) => l.includes('Latte Grande'))!;
    expect(latteLine).toMatch(/^2  Latte Grande +\$150\.00$/);
    // Modifier rows: indented + '+price' on the right.
    const almondLine = lines.find((l) => l.includes('Almond Milk'))!;
    expect(almondLine).toMatch(/^ {3}Almond Milk +\+\$20\.00$/);
    const shotLine = lines.find((l) => l.includes('Extra Shot'))!;
    expect(shotLine).toMatch(/^ {3}Extra Shot +\+\$30\.00$/);

    // Totals section.
    expect(lines.some((l) => l.startsWith('Subtotal:'))).toBe(true);
    expect(lines.some((l) => /^IVA 16%: +\$40\.69$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Total: +\$295\.00$/.test(l))).toBe(true);

    // Payment + change.
    expect(lines.some((l) => /^Cash: +\$300\.00$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Change: +\$5\.00$/.test(l))).toBe(true);
    // Footer.
    expect(lines.some((l) => l.includes('Thank you!'))).toBe(true);
  });

  it('omits the discount line when discount is 0', () => {
    const lines = formatReceipt(receiptInput({ discount_centavos: 0 }));
    expect(lines.some((l) => l.startsWith('Discount:'))).toBe(false);
  });

  it('renders a discount line when discount > 0', () => {
    const lines = formatReceipt(
      receiptInput({ discount_centavos: 500, total_centavos: 29000 }),
    );
    const discountLine = lines.find((l) => l.startsWith('Discount:'))!;
    expect(discountLine).toMatch(/^Discount: +-\$5\.00$/);
  });

  it('shows reference for non-cash payments and skips change line for card', () => {
    const lines = formatReceipt(
      receiptInput({
        payments: [
          { method: 'CARD', amount_centavos: 29500, change_centavos: 0, reference: 'TXN-9001' },
        ],
      }),
    );
    expect(lines.some((l) => /^Card: +\$295\.00$/.test(l))).toBe(true);
    expect(lines.some((l) => l === 'Ref: TXN-9001')).toBe(true);
    expect(lines.some((l) => l.startsWith('Change:'))).toBe(false);
  });

  it('omits the business address line when not configured', () => {
    const lines = formatReceipt(receiptInput({ business_address: null }));
    expect(lines.some((l) => l.includes('123 Main St'))).toBe(false);
    // Business name still renders.
    expect(lines.some((l) => l.trim() === 'Cafe POS')).toBe(true);
  });

  it('respects the 80mm width (48 chars) — longer rules and wider gutter', () => {
    const lines = formatReceipt(receiptInput({ width: 48 }));
    expect(lines[0]).toBe('='.repeat(48));
    // Latte line should still right-align the price within 48 columns.
    const latteLine = lines.find((l) => l.includes('Latte Grande'))!;
    expect(latteLine.length).toBe(48);
    expect(latteLine.endsWith('$150.00')).toBe(true);
  });
});
