// Weekly attendance grid: one row per employee, 7 columns Mon-Sun.
//
// Click a cell to cycle PRESENT → LATE → ABSENT → DAY_OFF → unset. The grid
// reads a single /attendance window for the visible week so a typical 10-row
// roster is one round trip per navigation.
//
// Layout
//   AdminViewShell
//   ├─ Toolbar (Prev · "Apr 22 – Apr 28" · Next · This week)
//   ├─ Legend chips
//   └─ Grid (sticky-left employee column, 7 day columns)

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAttendance,
  listAttendance,
  updateAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
} from '../../../api/attendance';
import { listEmployees, type EmployeeRecord } from '../../../api/employees';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';

interface AttendanceViewProps {
  onBack: () => void;
}

// JS Sunday=0 → we want Monday=0 for ISO weeks. Map and snap.
function snapToMondayUtc(input: Date): Date {
  const d = new Date(Date.UTC(
    input.getUTCFullYear(),
    input.getUTCMonth(),
    input.getUTCDate(),
  ));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

function nextStatus(current: AttendanceStatus | null): AttendanceStatus | null {
  switch (current) {
    case null:
      return 'PRESENT';
    case 'PRESENT':
      return 'LATE';
    case 'LATE':
      return 'ABSENT';
    case 'ABSENT':
      return 'DAY_OFF';
    case 'DAY_OFF':
      return null;
  }
}

function cellTone(status: AttendanceStatus | null): CSSProperties {
  switch (status) {
    case 'PRESENT':
      return { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' };
    case 'LATE':
      return { background: 'var(--gold)', color: '#2c2420', borderColor: 'var(--gold)' };
    case 'ABSENT':
      return { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' };
    case 'DAY_OFF':
      return { background: 'var(--text2)', color: '#fff', borderColor: 'var(--text2)' };
    default:
      return { background: 'var(--bg2)', color: 'var(--text3)' };
  }
}

function statusInitial(status: AttendanceStatus | null): string {
  switch (status) {
    case 'PRESENT':
      return 'P';
    case 'LATE':
      return 'L';
    case 'ABSENT':
      return 'A';
    case 'DAY_OFF':
      return 'O';
    default:
      return '·';
  }
}

export function AttendanceView({ onBack }: AttendanceViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [weekStart, setWeekStart] = useState<Date>(() => snapToMondayUtc(new Date()));
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t0 = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t0);
  }, [toast]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const fromIso = isoDate(weekStart);
  const toIso = isoDate(days[6]);

  const employeesQuery = useQuery({
    queryKey: ['admin', 'employees', { active: true }],
    queryFn: () => listEmployees({ active: true, limit: 100 }),
    staleTime: 60_000,
  });

  const attendanceQuery = useQuery({
    queryKey: ['admin', 'attendance', 'week', fromIso, toIso],
    queryFn: () =>
      listAttendance({
        from: fromIso,
        to: toIso,
        limit: 100,
      }),
    staleTime: 10_000,
  });

  // Build a lookup keyed by `${user_id}|${YYYY-MM-DD}` so cell rendering is
  // O(1) and stable.
  const byKey = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendanceQuery.data?.items ?? []) {
      map.set(`${r.user_id}|${r.date.slice(0, 10)}`, r);
    }
    return map;
  }, [attendanceQuery.data]);

  const setStatusMut = useMutation({
    mutationFn: async (input: {
      userId: string;
      date: string;
      target: AttendanceStatus | null;
      existing: AttendanceRecord | undefined;
    }) => {
      const { existing, target, userId, date } = input;
      if (target === null) {
        // Cycle back to "unset": we don't actually delete (would lose
        // is_paid/notes), but we set DAY_OFF as the no-op default. The
        // payroll math ignores DAY_OFF, so the financial effect is zero.
        // Hide it visually as "unset" via cellTone.
        if (!existing) return null;
        return updateAttendance(existing.id, { status: 'DAY_OFF' });
      }
      if (existing) {
        return updateAttendance(existing.id, { status: target });
      }
      return createAttendance({ user_id: userId, date, status: target });
    },
    onSuccess: () => {
      setToast({ kind: 'ok', text: t('attendance.saved') });
      queryClient.invalidateQueries({ queryKey: ['admin', 'attendance'] });
    },
    onError: () => setToast({ kind: 'err', text: t('attendance.saveFailed') }),
  });

  const employees: EmployeeRecord[] = (employeesQuery.data?.items ?? []).filter(
    (e) => e.weekly_salary !== null,
  );

  const cycleCell = useCallback(
    (employee: EmployeeRecord, date: Date) => {
      const iso = isoDate(date);
      const existing = byKey.get(`${employee.id}|${iso}`);
      const target = nextStatus(existing?.status ?? null);
      setStatusMut.mutate({ userId: employee.id, date: iso, target, existing });
    },
    [byKey, setStatusMut],
  );

  const headerActions = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        style={btnSecondary}
        onClick={() => setWeekStart((d) => addDays(d, -7))}
      >
        ‹ {t('attendance.prevWeek')}
      </button>
      <button
        type="button"
        style={btnSecondary}
        onClick={() => setWeekStart(snapToMondayUtc(new Date()))}
      >
        {t('attendance.thisWeek')}
      </button>
      <button
        type="button"
        style={btnSecondary}
        onClick={() => setWeekStart((d) => addDays(d, 7))}
      >
        {t('attendance.nextWeek')} ›
      </button>
    </div>
  );

  return (
    <AdminViewShell
      titleKey="attendance.title"
      subtitleKey="attendance.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      <div style={legendRow}>
        <LegendChip color="var(--green)" label={t('attendance.legend.present')} />
        <LegendChip color="var(--gold)" label={t('attendance.legend.late')} />
        <LegendChip color="var(--red)" label={t('attendance.legend.absent')} />
        <LegendChip color="var(--text2)" label={t('attendance.legend.dayOff')} />
        <span style={{ flex: 1 }} />
        <span style={weekLabel}>
          {fmtDay(days[0])} – {fmtDay(days[6])} ·{' '}
          {days[0].toLocaleDateString('en-US', { year: 'numeric' })}
        </span>
      </div>

      {employeesQuery.isLoading || attendanceQuery.isLoading ? (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      ) : employees.length === 0 ? (
        <div style={emptyState}>{t('attendance.empty')}</div>
      ) : (
        <div style={gridWrap}>
          <div style={gridHead}>
            <span style={gridHeadEmployee}>{t('attendance.col.employee')}</span>
            {days.map((d) => (
              <span key={d.toISOString()} style={gridHeadDay}>
                {fmtDay(d)}
              </span>
            ))}
          </div>
          {employees.map((emp) => (
            <div key={emp.id} style={gridRow}>
              <span style={gridRowEmployee}>
                <span style={empName}>{emp.name}</span>
                <span style={empSub}>{emp.position || ''}</span>
              </span>
              {days.map((d) => {
                const iso = isoDate(d);
                const rec = byKey.get(`${emp.id}|${iso}`);
                const status = rec?.status ?? null;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => cycleCell(emp, d)}
                    disabled={setStatusMut.isPending}
                    title={t(`attendance.status.${status ?? 'DAY_OFF'}` as any)}
                    style={{
                      ...gridCell,
                      ...cellTone(status),
                    }}
                  >
                    {statusInitial(status)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            ...toastStyle,
            background: toast.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          }}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </AdminViewShell>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={legendChip}>
      <span style={{ ...legendDot, background: color }} />
      {label}
    </span>
  );
}

// ─── Local styles ────────────────────────────────────────────────────────

const legendRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  marginBottom: 18,
};

const legendChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--text2)',
  fontWeight: 500,
};

const legendDot: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  display: 'inline-block',
};

const weekLabel: CSSProperties = {
  fontSize: 13,
  color: 'var(--text1)',
  fontWeight: 600,
  fontFamily: "'Playfair Display', serif",
};

const gridWrap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
};

const gridHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px repeat(7, 1fr)',
  padding: '12px 16px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: 'var(--text3)',
  gap: 8,
};

const gridHeadEmployee: CSSProperties = { paddingLeft: 4 };
const gridHeadDay: CSSProperties = { textAlign: 'center' };

const gridRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px repeat(7, 1fr)',
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
  gap: 8,
};

const gridRowEmployee: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const empName: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text1)',
};

const empSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const gridCell: CSSProperties = {
  height: 42,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btnSecondary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '40px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 18px',
  borderRadius: 999,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  zIndex: 300,
  boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
};
