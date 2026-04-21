import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
  type ListEmployeesParams,
} from '../api/employees';

const LIMIT = 50;

export function useEmployees(filters: Omit<ListEmployeesParams, 'cursor' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['employees', filters],
    queryFn: ({ pageParam }) =>
      listEmployees({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: ['employee', id],
    queryFn: () => getEmployee(id as string),
    enabled: !!id,
  });
}

function invalidateEmployees(
  qc: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  qc.invalidateQueries({ queryKey: ['employees'] });
  if (id) qc.invalidateQueries({ queryKey: ['employee', id] });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createEmployee,
    onSuccess: () => invalidateEmployees(qc),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateEmployee>[1];
    }) => updateEmployee(id, input),
    onSuccess: (data) => invalidateEmployees(qc, data.id),
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteEmployee,
    onSuccess: (data) => invalidateEmployees(qc, data.id),
  });
}
