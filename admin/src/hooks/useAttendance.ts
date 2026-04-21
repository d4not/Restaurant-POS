import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  deleteAttendance,
  listAttendance,
  logAttendance,
  updateAttendance,
  type ListAttendanceParams,
} from '../api/attendance';

/** Non-paginated fetch — the attendance page always queries a narrow window
 *  (one week per employee), so pulling every matching row in one call keeps
 *  the UI simple. Pass `enabled: false` to skip the fetch (e.g. when no user
 *  is selected yet). */
export function useAttendance(
  filters: Omit<ListAttendanceParams, 'cursor' | 'limit'> = {},
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: ['attendance', filters],
    queryFn: () => listAttendance({ ...filters, limit: 100 }),
    enabled,
  });
}

function invalidateAttendance(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['attendance'] });
  // Payroll math depends on attendance, so draft rows may need refresh.
  qc.invalidateQueries({ queryKey: ['payroll'] });
  qc.invalidateQueries({ queryKey: ['payrollPeriod'] });
}

export function useLogAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logAttendance,
    onSuccess: () => invalidateAttendance(qc),
  });
}

export function useUpdateAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateAttendance>[1];
    }) => updateAttendance(id, input),
    onSuccess: () => invalidateAttendance(qc),
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAttendance,
    onSuccess: () => invalidateAttendance(qc),
  });
}
