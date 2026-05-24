// Display helpers for product types. Centralised so the badge styling and
// the human-readable hint stay in sync everywhere the type is rendered.

import type { CSSProperties } from 'react';
import type { ProductType } from '../api/products';

export function productTypeLabel(t: ProductType): string {
  switch (t) {
    case 'DISH':        return 'Dish';
    case 'PRODUCT':     return 'Product';
    case 'PREPARATION': return 'Preparation';
  }
}

// Used for the in-form / detail-page hint copy explaining what each type is
// for. Mirrors `admin/src/pages/menu/product-meta.ts`.
export function productTypeHint(t: ProductType): string {
  switch (t) {
    case 'DISH':
      return 'A prepared item made from a recipe (e.g. latte, burger). Can have size variants and modifier groups.';
    case 'PRODUCT':
      return 'A ready-to-sell packaged item (e.g. bottled water, cookie). Optionally linked to a supply item and modifications.';
    case 'PREPARATION':
      return 'A sub-recipe used as an ingredient by other recipes (e.g. simple syrup). Not sold directly.';
  }
}

// Pill/badge background + text colour per type. Returns inline CSSProperties
// because the terminal doesn't ship a Badge component — each consumer spreads
// these onto its own pill element.
export function productTypeBadgeStyle(t: ProductType): CSSProperties {
  switch (t) {
    case 'DISH':
      return {
        background: 'rgba(74,140,92,0.12)',
        color: 'var(--green)',
        border: '1px solid rgba(74,140,92,0.30)',
      };
    case 'PRODUCT':
      return {
        background: 'rgba(201,164,92,0.10)',
        color: 'var(--gold)',
        border: '1px solid rgba(201,164,92,0.32)',
      };
    case 'PREPARATION':
      return {
        background: 'rgba(168,152,136,0.16)',
        color: 'var(--text2)',
        border: '1px solid rgba(168,152,136,0.36)',
      };
  }
}

// Color for the food cost % display. The standard restaurant target is < 30%;
// >35% gets the red treatment, 28–35% the gold warning, and below that green.
export function foodCostColor(pct: number): string {
  if (pct > 35) return 'var(--red)';
  if (pct > 28) return 'var(--gold)';
  return 'var(--green)';
}
