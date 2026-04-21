import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreateModificationInput,
  ProductModification,
  UpdateModificationInput,
} from '../types/menu';

export function listModifications(productId: string, limit = 100) {
  return api.get<Paginated<ProductModification>>(
    `/products/${productId}/modifications`,
    { limit },
  );
}

export function createModification(productId: string, input: CreateModificationInput) {
  return api.post<ProductModification>(
    `/products/${productId}/modifications`,
    input,
  );
}

export function updateModification(
  productId: string,
  modificationId: string,
  input: UpdateModificationInput,
) {
  return api.patch<ProductModification>(
    `/products/${productId}/modifications/${modificationId}`,
    input,
  );
}

export function deleteModification(productId: string, modificationId: string) {
  return api.delete<void>(
    `/products/${productId}/modifications/${modificationId}`,
  );
}
