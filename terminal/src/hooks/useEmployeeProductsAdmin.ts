import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEmployeeProduct,
  deleteEmployeeProduct,
  listEmployeeProductsAdmin,
  updateEmployeeProduct,
} from '../api/employee-products';
import type {
  CreateEmployeeProductInput,
  EmployeeProduct,
  ListEmployeeProductsParams,
  UpdateEmployeeProductInput,
} from '../api/employee-products';
import type { PageResult } from '../api/pagination';

export function useEmployeeProductsAdmin(params?: ListEmployeeProductsParams) {
  return useQuery<PageResult<EmployeeProduct>>({
    queryKey: ['admin', 'employeeProducts', params],
    queryFn: () => listEmployeeProductsAdmin(params),
    staleTime: 30_000,
  });
}

export function useCreateEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeeProductInput) => createEmployeeProduct(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employeeProducts'] });
    },
  });
}

export function useUpdateEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeeProductInput }) =>
      updateEmployeeProduct(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employeeProducts'] });
    },
  });
}

export function useDeleteEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEmployeeProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employeeProducts'] });
    },
  });
}
