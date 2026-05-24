// Packaged-product modifications (flavours/presentations). Only valid when
// the parent Product has type=PRODUCT. Each modification can link to its own
// supply item so inventory deducts the right SKU.

import { api } from './client';
import type {
  CreateModificationInput,
  ProductModification,
  UpdateModificationInput,
} from './products';

export function listModifications(
  productId: string,
): Promise<ProductModification[]> {
  return api.get<ProductModification[]>(`/products/${productId}/modifications`);
}

export function createModification(
  productId: string,
  input: CreateModificationInput,
): Promise<ProductModification> {
  return api.post<ProductModification>(
    `/products/${productId}/modifications`,
    input,
  );
}

export function updateModification(
  productId: string,
  modificationId: string,
  input: UpdateModificationInput,
): Promise<ProductModification> {
  return api.patch<ProductModification>(
    `/products/${productId}/modifications/${modificationId}`,
    input,
  );
}

export function deleteModification(
  productId: string,
  modificationId: string,
): Promise<void> {
  return api.delete<void>(
    `/products/${productId}/modifications/${modificationId}`,
  );
}
