import { api } from './client';
import type {
  CreateModificationInput,
  ProductModification,
  UpdateModificationInput,
} from '../types/menu';

export function listModifications(productId: string) {
  return api.get<ProductModification[]>(
    `/products/${productId}/modifications`,
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
