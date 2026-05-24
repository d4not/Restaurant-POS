import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addAdjustment,
  generatePayroll,
  getPayroll,
  listPayroll,
  removeAdjustment,
  updatePayroll,
  type ListPayrollParams,
} from '../api/payroll';
import type { CreateAdjustmentInput } from '../types/people';

const LIMIT = 50;

export function usePayroll(
  filters: Omit<ListPayrollParams, 'cursor' | 'limit'> = {},
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useInfiniteQuery({
    queryKey: ['payroll', filters],
    queryFn: ({ pageParam }) =>
      listPayroll({ ...filters, cursor: pageParam, limit: LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function usePayrollPeriod(id: string | undefined) {
  return useQuery({
    queryKey: ['payrollPeriod', id],
    queryFn: () => getPayroll(id as string),
    enabled: !!id,
  });
}

function invalidatePayroll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: ['payroll'] });
  if (id) qc.invalidateQueries({ queryKey: ['payrollPeriod', id] });
}

export function useGeneratePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generatePayroll,
    onSuccess: () => invalidatePayroll(qc),
  });
}

export function useUpdatePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updatePayroll>[1];
    }) => updatePayroll(id, input),
    onSuccess: (data) => invalidatePayroll(qc, data.id),
  });
}

export function useAddAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      periodId,
      input,
    }: {
      periodId: string;
      input: CreateAdjustmentInput;
    }) => addAdjustment(periodId, input),
    onSuccess: (data) => invalidatePayroll(qc, data.id),
  });
}

export function useRemoveAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      periodId,
      adjustmentId,
    }: {
      periodId: string;
      adjustmentId: string;
    }) => removeAdjustment(periodId, adjustmentId),
    onSuccess: (data) => invalidatePayroll(qc, data.id),
  });
}
