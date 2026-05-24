import { describe, it, expect } from 'vitest';
import { Decimal } from '../../src/lib/decimal.js';
import { buildWhatsappLink } from '../../src/modules/purchases/whatsapp.js';

describe('buildWhatsappLink', () => {
  const baseSupplier = {
    id: 's1',
    name: 'Frialsa',
    whatsapp_phone: '525512345678',
    message_template: null,
  };

  const basePurchase = {
    id: 'p1',
    date: '2026-05-24T08:00:00Z',
    total: new Decimal(48500),
    expected_arrival: '2026-05-25T10:00:00Z',
    supplier: baseSupplier,
    items: [
      {
        package_quantity: 3,
        supply: { name: 'Hielo 5kg' },
        packaging: { name: 'caja de 4' },
      },
      {
        package_quantity: 1,
        supply: { name: 'Hielo seco' },
        packaging: null,
      },
    ],
  };

  it('builds a wa.me URL with sanitized phone and encoded text', () => {
    const out = buildWhatsappLink(basePurchase);
    expect(out.requires_phone).toBe(false);
    expect(out.url).not.toBeNull();
    expect(out.url!.startsWith('https://wa.me/525512345678?text=')).toBe(true);
    // Body decodes back to the rendered message verbatim.
    const decoded = decodeURIComponent(out.url!.split('?text=')[1] ?? '');
    expect(decoded).toBe(out.message);
  });

  it('renders default template with items + total + expected_arrival', () => {
    const { message } = buildWhatsappLink(basePurchase);
    expect(message).toContain('Hola Frialsa, mi pedido:');
    expect(message).toContain('• 3× Hielo 5kg (caja de 4)');
    expect(message).toContain('• 1× Hielo seco');
    expect(message).toContain('Total estimado: $485.00');
    expect(message).toMatch(/Fecha estimada:.+(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i);
  });

  it('strips non-digits from the phone number', () => {
    const out = buildWhatsappLink({
      ...basePurchase,
      supplier: { ...baseSupplier, whatsapp_phone: '+52 (55) 1234-5678' },
    });
    expect(out.url!.includes('/525512345678?')).toBe(true);
  });

  it('flags requires_phone when whatsapp_phone is missing or empty', () => {
    const out = buildWhatsappLink({
      ...basePurchase,
      supplier: { ...baseSupplier, whatsapp_phone: null },
    });
    expect(out.requires_phone).toBe(true);
    expect(out.url).toBeNull();
    // Message still renders so the UI can show a preview + "add phone" CTA.
    expect(out.message).toContain('Hola Frialsa');
  });

  it('uses supplier custom template when present', () => {
    const out = buildWhatsappLink({
      ...basePurchase,
      supplier: {
        ...baseSupplier,
        message_template: 'PEDIDO {supplier_name} - {total}\n{items}',
      },
    });
    expect(out.message).toMatch(/^PEDIDO Frialsa - \$485\.00\n/);
    expect(out.message).toContain('• 3× Hielo 5kg');
  });

  it('falls back to "(sin productos)" when items array is empty', () => {
    const out = buildWhatsappLink({ ...basePurchase, items: [] });
    expect(out.message).toContain('(sin productos)');
  });
});
