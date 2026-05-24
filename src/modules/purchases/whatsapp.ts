// WhatsApp deep-link builder. Operators tap "Send via WhatsApp" in the UI;
// the frontend opens the returned `url` in a new tab (wa.me intercepts on
// device into the actual WhatsApp client). No automation is in scope for v1
// — we hand the operator a pre-filled message and they hit Send.

import { Decimal } from '../../lib/decimal.js';

export interface WhatsappLink {
  url: string | null;
  message: string;
  requires_phone: boolean;
}

// The fields we need off a Purchase. Loose so callers can pass either the
// service's loaded shape or a slimmer test fixture.
interface PurchaseLike {
  id: string;
  date: Date | string;
  expected_arrival?: Date | string | null;
  total: Decimal | string | number;
  supplier?: {
    id: string;
    name: string;
    whatsapp_phone?: string | null;
    message_template?: string | null;
  } | null;
  items?: ReadonlyArray<{
    package_quantity: Decimal | string | number;
    supply?: { name: string } | null;
    packaging?: { name: string } | null;
  }>;
}

const DEFAULT_TEMPLATE = [
  'Hola {supplier_name}, mi pedido:',
  '',
  '{items}',
  '',
  'Total estimado: {total}',
  'Fecha estimada: {date}',
].join('\n');

function formatItemsBlock(items: PurchaseLike['items']): string {
  if (!items?.length) return '(sin productos)';
  return items
    .map((it) => {
      const qty = new Decimal(it.package_quantity).toString();
      const supplyName = it.supply?.name ?? 'producto';
      const pkg = it.packaging?.name ? ` (${it.packaging.name})` : '';
      return `• ${qty}× ${supplyName}${pkg}`;
    })
    .join('\n');
}

function formatMxn(value: Decimal | string | number): string {
  // Centavos → pesos with two-decimal MXN formatting. Anything weird falls
  // back to "$0.00" so the message stays sendable.
  try {
    const centavos = new Decimal(value);
    const pesos = centavos.div(100).toNumber();
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pesos);
  } catch {
    return '$0.00';
  }
}

function formatLongDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

// Strip everything but digits — wa.me wants the raw E.164 number without
// the leading '+'. Accepts "+52 (55) 1234-5678" → "5255 12345678".
function sanitizePhone(input: string): string {
  return input.replace(/\D/g, '');
}

export function buildWhatsappLink(purchase: PurchaseLike): WhatsappLink {
  const supplier = purchase.supplier ?? null;
  const supplierName = supplier?.name ?? 'proveedor';
  const template = supplier?.message_template?.trim() || DEFAULT_TEMPLATE;

  const vars: Record<string, string> = {
    supplier_name: supplierName,
    items: formatItemsBlock(purchase.items),
    total: formatMxn(purchase.total ?? 0),
    date: formatLongDate(purchase.expected_arrival ?? purchase.date),
  };

  const message = renderTemplate(template, vars);

  if (!supplier?.whatsapp_phone) {
    return { url: null, message, requires_phone: true };
  }
  const phone = sanitizePhone(supplier.whatsapp_phone);
  if (!phone) {
    return { url: null, message, requires_phone: true };
  }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  return { url, message, requires_phone: false };
}
