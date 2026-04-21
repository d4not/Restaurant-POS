import type { BadgeTone } from '../../components/ui';
import type { ProductType } from '../../types/menu';

export function productTypeTone(t: ProductType): BadgeTone {
  switch (t) {
    case 'DISH':        return 'gold';
    case 'PRODUCT':     return 'blue';
    case 'PREPARATION': return 'gray';
  }
}

export function productTypeLabel(t: ProductType): string {
  switch (t) {
    case 'DISH':        return 'Dish';
    case 'PRODUCT':     return 'Product';
    case 'PREPARATION': return 'Preparation';
  }
}

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
