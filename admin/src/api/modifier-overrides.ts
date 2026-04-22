import { api } from './client';
import type {
  CreateOverrideInput,
  ModifierProductOverride,
  UpdateOverrideInput,
} from '../types/menu';

export function listOverrides(productId: string) {
  return api.get<ModifierProductOverride[]>(`/products/${productId}/modifier-overrides`);
}

export function createOverride(productId: string, input: CreateOverrideInput) {
  return api.post<ModifierProductOverride>(
    `/products/${productId}/modifier-overrides`,
    input,
  );
}

export function updateOverride(
  productId: string,
  modifierId: string,
  input: UpdateOverrideInput,
) {
  return api.patch<ModifierProductOverride>(
    `/products/${productId}/modifier-overrides/${modifierId}`,
    input,
  );
}

export function deleteOverride(productId: string, modifierId: string) {
  return api.delete<void>(`/products/${productId}/modifier-overrides/${modifierId}`);
}
