import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createEmployeeProduct,
  deleteEmployeeProduct,
  getEmployeeProduct,
  listEmployeeProducts,
  listEmployeeSales,
  updateEmployeeProduct,
  type CreateEmployeeProductInput,
  type ListEmployeeProductsParams,
  type ListEmployeeSalesParams,
  type UpdateEmployeeProductInput,
} from '../api/employee-products';

const LIMIT = 50;

export function useEmployeeProducts(
  filters: Omit<ListEmployeeProductsParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['employee-products', filters],
    queryFn: ({ pageParam }) =>
      listEmployeeProducts({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEmployeeProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['employee-product', id],
    queryFn: () => getEmployeeProduct(id as string),
    enabled: !!id,
  });
}

export function useCreateEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeeProductInput) => createEmployeeProduct(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-products'] }),
  });
}

export function useUpdateEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeeProductInput }) =>
      updateEmployeeProduct(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['employee-products'] });
      qc.invalidateQueries({ queryKey: ['employee-product', data.id] });
    },
  });
}

export function useDeleteEmployeeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEmployeeProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-products'] }),
  });
}

export function useEmployeeSales(
  filters: Omit<ListEmployeeSalesParams, 'cursor' | 'limit'> = {},
) {
  return useInfiniteQuery({
    queryKey: ['employee-sales', filters],
    queryFn: ({ pageParam }) =>
      listEmployeeSales({ ...filters, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
