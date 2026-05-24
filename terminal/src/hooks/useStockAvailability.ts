import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAvailability,
  type AvailabilitySnapshot,
  type ModifierAvailability,
  type ProductAvailability,
} from '../api/stock';

/**
 * Real-time menu availability for the active register.
 *
 * Polling 30s + refetch on window focus matches the lunch-rush cadence: a
 * shift that runs out of milk in the bar should see the card grey within
 * seconds of the next refetch, and a tablet returning from background gets
 * fresh data before its first tap. Caches are also invalidated on payment
 * success (in useOrders), so the practical refresh latency is much lower than
 * the polling interval.
 */
export function useStockAvailability(registerId: string | null | undefined) {
  return useQuery({
    queryKey: ['stock-availability', registerId ?? null],
    queryFn: () => fetchAvailability(registerId ?? null),
    enabled: true,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export interface AvailabilityIndex {
  byProductVariant: Map<string, ProductAvailability>;
  byModifier: Map<string, ModifierAvailability>;
  snapshot: AvailabilitySnapshot | null;
}

/** O(1) lookups by (product_id, variant_id?) and by modifier_id. */
export function indexAvailability(
  snapshot: AvailabilitySnapshot | null | undefined,
): AvailabilityIndex {
  const byProductVariant = new Map<string, ProductAvailability>();
  const byModifier = new Map<string, ModifierAvailability>();
  if (snapshot) {
    for (const p of snapshot.products) {
      byProductVariant.set(productVariantKey(p.product_id, p.variant_id), p);
    }
    for (const m of snapshot.modifiers) {
      byModifier.set(m.modifier_id, m);
    }
  }
  return { byProductVariant, byModifier, snapshot: snapshot ?? null };
}

export function productVariantKey(
  productId: string,
  variantId: string | null | undefined,
): string {
  return `${productId}|${variantId ?? ''}`;
}

/** Convenience: index built from the latest query data, memoized. */
export function useAvailabilityIndex(
  snapshot: AvailabilitySnapshot | null | undefined,
): AvailabilityIndex {
  return useMemo(() => indexAvailability(snapshot), [snapshot]);
}
