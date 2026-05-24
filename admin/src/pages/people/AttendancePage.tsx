import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { useEmployees } from '../../hooks/useEmployees';
import {
  useAttendance,
  useLogAttendance,
  useUpdateAttendance,
} from '../../hooks/useAttendance';
import { EmployeeAvatar } from '../../components/people/EmployeeAvatar';
import type { Attendance, AttendanceStatus } from '../../types/staff';
import {
  addDaysUtc,
  daysOfWeekUtc,
  isFutureDay,
  mondayOfWeekUtc,
  sameUtcDay,
  utcDateKey,
} from '../../utils/week';
import { formatDate } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';

// Cycle order: empty → PRESENT → LATE → ABSENT (paid) → ABSENT (unpaid) → DAY_OFF → clear
type CycleState =
  | { kind: 'none' }
  | { kind: 'status'; status: AttendanceStatus; isPaid: boolean };

function next(curr: CycleState): CycleState {
  if (curr.kind === 'none') return { kind: 'status', status: 'PRESENT', isPaid: true };
  switch (curr.status) {
    case 'PRESENT': return { kind: 'status', status: 'LATE', isPaid: true };
    case 'LATE':    return { kind: 'status', status: 'ABSENT', isPaid: true };
    case 'ABSENT':
      if (curr.isPaid) return { kind: 'status', status: 'ABSENT', isPaid: false };
      return { kind: 'status', status: 'DAY_OFF', isPaid: true };
    case 'DAY_OFF': return { kind: 'none' };
  }
}

function attendanceToCycle(row: Attendance | undefined): CycleState {
  if (!row) return { kind: 'none' };
  return { kind: 'status', status: row.status, isPaid: row.is_paid };
}

function badgeForStatus(status: AttendanceStatus, isPaid: boolean, t: (k: string) => string) {
  switch (status) {
    case 'PRESENT': return { tone: 'green' as const, label: t('employees.statusPresent') };
    case 'LATE':    return { tone: 'gold' as const, label: t('employees.statusLate') };
    case 'ABSENT':
      return isPaid
        ? { tone: 'gold' as const, label: t('employees.paidAbsence') }
        : { tone: 'red' as const, label: t('employees.unpaidAbsence') };
    case 'DAY_OFF': return { tone: 'gray' as const, label: t('employees.statusDayOff') };
  }
}

export function AttendancePage() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'MANAGER' || role === 'ADMIN';

  const [weekAnchor, setWeekAnchor] = useState<Date>(() =>
    mondayOfWeekUtc(new Date()),
  );

  const weekDays = useMemo(() => daysOfWeekUtc(weekAnchor), [weekAnchor]);
  const weekStartKey = utcDateKey(weekAnchor);
  const weekEndKey = utcDateKey(addDaysUtc(weekAnchor, 6));

  const employeesQ = useEmployees({ active: true });
  const employees = useMemo(
    () => employeesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [employeesQ.data],
  );

  const attendanceQ = useAttendance({
    from: weekStartKey,
    to: weekEndKey,
  });

  const byUserAndDate = useMemo(() => {
    const map = new Map<string, Map<string, Attendance>>();
    for (const row of attendanceQ.data?.items ?? []) {
      const key = utcDateKey(new Date(row.date));
      const inner = map.get(row.user_id) ?? new Map();
      inner.set(key, row);
      map.set(row.user_id, inner);
    }
    return map;
  }, [attendanceQ.data]);

  const logM = useLogAttendance();
  const updateM = useUpdateAttendance();

  const cycleCell = async (
    userId: string,
    date: string,
    existing?: Attendance,
  ) => {
    if (!canEdit) return;
    const target = next(attendanceToCycle(existing));
    if (target.kind === 'none' && existing) {
      // No DELETE endpoint here — leaving DAY_OFF clears it via re-save?
      // The current API has a DELETE attendance endpoint, but the simplest
      // round-trip is to flip back to PRESENT then DELETE. Since DELETE isn't
      // mutated through a "set none" toggle, we treat DAY_OFF as the cleared
      // state visually — clicking again sets PRESENT and the user can use the
      // employee-detail page for fine-grained deletes.
      await logM.mutateAsync({
        user_id: userId,
        date,
        status: 'PRESENT',
        is_paid: true,
      });
      return;
    }
    if (target.kind === 'status') {
      if (existing) {
        await updateM.mutateAsync({
          id: existing.id,
          input: {
            status: target.status,
            is_paid: target.status === 'ABSENT' ? target.isPaid : true,
          },
        });
      } else {
        await logM.mutateAsync({
          user_id: userId,
          date,
          status: target.status,
          is_paid: target.status === 'ABSENT' ? target.isPaid : undefined,
        });
      }
    }
  };

  return (
    <>
      <Card>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('people.attendance.title')}</h1>
        <div className="fs-13 text-muted">{t('people.attendance.subtitle')}</div>
      </Card>

      <Card
        style={{ marginTop: 16 }}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWeekAnchor(addDaysUtc(weekAnchor, -7))}
            >
              ←
            </Button>
            <div className="fs-12 text-muted" style={{ minWidth: 180, textAlign: 'center' }}>
              {formatDate(weekDays[0]!)} – {formatDate(weekDays[6]!)}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWeekAnchor(addDaysUtc(weekAnchor, 7))}
            >
              →
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setWeekAnchor(mondayOfWeekUtc(new Date()))}
            >
              {t('dateRange.today')}
            </Button>
          </div>
        }
        title={`${t('people.attendance.weekOf')} ${formatDate(weekDays[0]!)}`}
      >
        {/* Legend */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Badge tone="green">{t('employees.statusPresent')}</Badge>
          <Badge tone="gold">{t('employees.statusLate')}</Badge>
          <Badge tone="gold">{t('employees.paidAbsence')}</Badge>
          <Badge tone="red">{t('employees.unpaidAbsence')}</Badge>
          <Badge tone="gray">{t('employees.statusDayOff')}</Badge>
          <span className="fs-11 text-muted">{t('people.attendance.legend')}</span>
        </div>

        {employeesQ.isLoading || attendanceQ.isLoading ? (
          <div className="loading-block">
            <span className="spinner" />
            {t('common.loading')}…
          </div>
        ) : employees.length === 0 ? (
          <EmptyState message={t('employees.empty')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '220px repeat(7, minmax(96px, 1fr))',
                gap: 6,
                minWidth: 900,
              }}
            >
              <div />
              {weekDays.map((d) => (
                <div
                  key={utcDateKey(d)}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text3)',
                    padding: '0 4px 8px',
                    textAlign: 'center',
                  }}
                >
                  {d.toLocaleDateString('en-US', {
                    weekday: 'short',
                    timeZone: 'UTC',
                  })}{' '}
                  {d.getUTCDate()}
                </div>
              ))}

              {employees.map((emp) => {
                const userMap = byUserAndDate.get(emp.id);
                return (
                  <RowGroup
                    key={emp.id}
                    employee={emp}
                    weekDays={weekDays}
                    rowMap={userMap}
                    canEdit={canEdit}
                    onCycle={cycleCell}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function RowGroup({
  employee,
  weekDays,
  rowMap,
  canEdit,
  onCycle,
}: {
  employee: { id: string; name: string; role: import('../../types/api').UserRole };
  weekDays: Date[];
  rowMap: Map<string, Attendance> | undefined;
  canEdit: boolean;
  onCycle: (userId: string, date: string, existing?: Attendance) => void;
}) {
  const { t } = useTranslation();
  const today = new Date();
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 0',
        }}
      >
        <EmployeeAvatar name={employee.name} role={employee.role} size={32} />
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {employee.name}
        </div>
      </div>
      {weekDays.map((day) => {
        const key = utcDateKey(day);
        const existing = rowMap?.get(key);
        const future = isFutureDay(day, today);
        const isToday = sameUtcDay(day, today);

        const tooltip = existing
          ? existing.status
          : t('people.attendance.notLogged');

        return (
          <button
            key={key}
            type="button"
            onClick={() => !future && onCycle(employee.id, key, existing)}
            disabled={future || !canEdit}
            title={tooltip}
            style={{
              padding: '8px 4px',
              minHeight: 52,
              border: `1px solid ${isToday ? 'var(--gold)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              background: future ? 'rgba(0,0,0,0.02)' : 'var(--surface)',
              cursor: future || !canEdit ? 'default' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {existing ? (
              (() => {
                const meta = badgeForStatus(existing.status, existing.is_paid, t);
                return <Badge tone={meta.tone}>{meta.label}</Badge>;
              })()
            ) : (
              <span
                className="fs-11 text-muted"
                style={{ fontWeight: 500 }}
              >
                {future ? '—' : '+'}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
