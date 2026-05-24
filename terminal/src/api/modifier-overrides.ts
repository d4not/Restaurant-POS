// Per-product modifier overrides. Each row tweaks how one Modifier behaves
// inside the recipe of one specific Product (e.g. Latte needs 150 ml of oat
// milk, Frappe needs 90 ml).

import { api } from './client';
import type {
  CreateOverrideInput,
  ModifierProductOverride,
  UpdateOverrideInput,
} from './products';

export function listOverrides(
  productId: string,
): Promise<ModifierProductOverride[]> {
  return api.get<ModifierProductOverride[]>(
    `/products/${productId}/modifier-overrides`,
  );
}

export function createOverride(
  productId: string,
  input: CreateOverrideInput,
): Promise<ModifierProductOverride> {
  return api.post<ModifierProductOverride>(
    `/products/${productId}/modifier-overrides`,
    input,
  );
}

export function updateOverride(
  productId: string,
  modifierId: string,
  input: UpdateOverrideInput,
): Promise<ModifierProductOverride> {
  return api.patch<ModifierProductOverride>(
    `/products/${productId}/modifier-overrides/${modifierId}`,
    input,
  );
}

export function deleteOverride(
  productId: string,
  modifierId: string,
): Promise<void> {
  return api.delete<void>(
    `/products/${productId}/modifier-overrides/${modifierId}`,
  );
}
