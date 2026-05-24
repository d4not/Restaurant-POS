// Employees roster view.
//
// Layout
//   AdminViewShell (Back · "Employees" · subtitle · [+ New])
//   ├─ Filter row (search · status pill)
//   ├─ Table of EmployeeRecord rows
//   └─ Right-side drawer (Profile / Schedule / Attendance / Payroll)
//
// State
//   - The roster query owns the list. Mutations call api/employees.ts and
//     invalidate ['admin', 'employees'].
//   - Selecting a row opens the drawer overlay; the drawer reads from the
//     cached list (no per-employee getEmployee round trip until the user
//     opens Attendance/Payroll which need their own queries).
//   - Create employee uses a centered modal that reuses the same form
//     component as the drawer's Profile tab.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEmployee,
  deactivateEmployee,
  listEmployees,
  updateEmployee,
  type CreateEmployeeInput,
  type EmployeeRecord,
  type UpdateEmployeeInput,
  type UserRole,
} from '../../../api/employees';
import {
  createAttendance,
  listAttendance,
  updateAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
} from '../../../api/attendance';
import { listPayroll, type PayrollPeriod } from '../../../api/payroll';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';

interface EmployeesViewProps {
  onBack: () => void;
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type TabKey = 'profile' | 'schedule' | 'attendance' | 'payroll';

// Default schedule assumption: 6 days × 8h. Used purely to derive an hourly
// rate display — the actual payroll math runs on weekly_salary / days_expected
// at the backend, untouched by this view.
const DEFAULT_DAYS_PER_WEEK = 6;
const DEFAULT_HOURS_PER_DAY = 8;

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER', 'BARISTA', 'WAITER'];

const COLS = '1.6fr 100px 130px 130px 100px 110px 100px';

// ─── Public component ────────────────────────────────────────────────────

export function EmployeesView({ onBack }: EmployeesViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t0 = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t0);
  }, [toast]);

  const listFilters = useMemo(
    () => ({
      active:
        status === 'ALL' ? undefined : status === 'ACTIVE' ? true : false,
      search: search.trim() || undefined,
    }),
    [status, search],
  );

  const query = useQuery({
    queryKey: ['admin', 'employees', listFilters],
    queryFn: () => listEmployees(listFilters),
    staleTime: 30_000,
  });

  const rows = query.data?.items ?? [];
  const selected = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;

  const headerActions = (
    <button type="button" style={btnPrimary} onClick={() => setCreateOpen(true)}>
      {t('employees.new')}
    </button>
  );

  return (
    <AdminViewShell
      titleKey="employees.title"
      subtitleKey="employees.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      {/* ─── Filter row ──────────────────────────────────────────────────── */}
      <div style={adminStyles.filterRow as CSSProperties}>
        <div style={{ ...(adminStyles.filterField as CSSProperties), flex: 1, minWidth: 240 }}>
          <span style={adminStyles.filterLabel as CSSProperties}>{t('employees.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('employees.search')}
            style={textInputStyle}
          />
        </div>
        <div style={adminStyles.filterField as CSSProperties}>
          <span style={adminStyles.filterLabel as CSSProperties}>
            {t('employees.col.status')}
          </span>
          <div style={adminStyles.pillRow as CSSProperties}>
            {(['ALL', 'ACTIVE', 'INACTIVE'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{
                  ...(adminStyles.pillBtn as CSSProperties),
                  ...(status === s ? (adminStyles.pillBtnActive as CSSProperties) : {}),
                }}
              >
                {s === 'ALL'
                  ? t('employees.filter.all')
                  : s === 'ACTIVE'
                    ? t('employees.filter.active')
                    : t('employees.filter.inactive')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Table ──────────────────────────────────────────────────────── */}
      <div style={tableWrap}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('employees.col.name')}</span>
          <span>{t('employees.col.role')}</span>
          <span>{t('employees.col.position')}</span>
          <span style={cellNumHead}>{t('employees.col.weeklySalary')}</span>
          <span style={cellNumHead}>{t('employees.col.hourly')}</span>
          <span>{t('employees.col.hireDate')}</span>
          <span>{t('employees.col.status')}</span>
        </div>
        {query.isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}
        {!query.isLoading && rows.length === 0 && (
          <div style={emptyState}>{t('employees.empty')}</div>
        )}
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            onClick={() => setSelectedId(row.id)}
            style={{
              ...tableRow,
              gridTemplateColumns: COLS,
              ...(selectedId === row.id ? selectedRow : {}),
            }}
          >
            <span style={nameCell}>
              <span style={nameMain}>{row.name}</span>
              <span style={nameSub}>{row.email}</span>
            </span>
            <span style={cellMuted}>{t(`role.${row.role.toLowerCase()}` as any)}</span>
            <span style={cellMuted}>{row.position || '—'}</span>
            <span style={cellNum}>
              {row.weekly_salary ? formatMoneyPlain(row.weekly_salary) : '—'}
            </span>
            <span style={cellNum}>{deriveHourlyDisplay(row.weekly_salary)}</span>
            <span style={cellMuted}>{fmtShortDate(row.hire_date)}</span>
            <span>
              <span
                style={{
                  ...statusBadge,
                  ...(row.active ? statusBadgeOk : statusBadgeOff),
                }}
              >
                {row.active
                  ? t('employees.status.active')
                  : t('employees.status.inactive')}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ─── Drawer ─────────────────────────────────────────────────────── */}
      {selected && (
        <EmployeeDrawer
          employee={selected}
          onClose={() => setSelectedId(null)}
          onSaved={(text) => {
            setToast({ kind: 'ok', text });
            queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {/* ─── Create modal ───────────────────────────────────────────────── */}
      {createOpen && (
        <CreateEmployeeModal
          onClose={() => setCreateOpen(false)}
          onSaved={(text) => {
            setToast({ kind: 'ok', text });
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {/* ─── Toast ──────────────────────────────────────────────────────── */}
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

// ─── Drawer ──────────────────────────────────────────────────────────────

interface EmployeeDrawerProps {
  employee: EmployeeRecord;
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function EmployeeDrawer({ employee, onClose, onSaved, onError }: EmployeeDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('profile');

  // Esc to close. Captured at the document so the global launcher Esc
  // doesn't fire underneath us.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  return (
    <div style={drawerScrim} onClick={onClose}>
      <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={drawerHead}>
          <div>
            <h3 style={drawerTitle}>{employee.name}</h3>
            <p style={drawerSub}>
              {employee.position || t(`role.${employee.role.toLowerCase()}` as any)}
              {' · '}
              {employee.email}
            </p>
          </div>
          <button type="button" onClick={onClose} style={drawerClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={tabRow}>
          {(
            [
              ['profile', 'employees.detail.profile'],
              ['schedule', 'employees.detail.schedule'],
              ['attendance', 'employees.detail.attendance'],
              ['payroll', 'employees.detail.payroll'],
            ] as Array<[TabKey, any]>
          ).map(([key, labelKey]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                ...tabBtn,
                ...(tab === key ? tabBtnActive : {}),
              }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div style={drawerBody}>
          {tab === 'profile' && (
            <ProfileTab employee={employee} onSaved={onSaved} onError={onError} />
          )}
          {tab === 'schedule' && <ScheduleTab employee={employee} />}
          {tab === 'attendance' && (
            <AttendanceTab employee={employee} onSaved={onSaved} onError={onError} />
          )}
          {tab === 'payroll' && <PayrollTab employee={employee} />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile tab ─────────────────────────────────────────────────────────

interface ProfileTabProps {
  employee: EmployeeRecord;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function ProfileTab({ employee, onSaved, onError }: ProfileTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<UpdateEmployeeInput & { password?: string }>(
    {
      name: employee.name,
      email: employee.email,
      role: employee.role,
      position: employee.position,
      phone: employee.phone,
      emergency_contact: employee.emergency_contact,
      weekly_salary: employee.weekly_salary ? Number(employee.weekly_salary) : null,
      hire_date: employee.hire_date ? employee.hire_date.slice(0, 10) : null,
      notes: employee.notes,
      active: employee.active,
      password: '',
    },
  );

  const updateMut = useMutation({
    mutationFn: (input: UpdateEmployeeInput) => updateEmployee(employee.id, input),
    onSuccess: () => {
      onSaved(t('employees.saved'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
    },
    onError: () => onError(t('employees.saveFailed')),
  });

  const deactivateMut = useMutation({
    mutationFn: () => deactivateEmployee(employee.id),
    onSuccess: () => {
      onSaved(t('employees.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
    },
    onError: () => onError(t('employees.saveFailed')),
  });

  const reactivateMut = useMutation({
    mutationFn: () => updateEmployee(employee.id, { active: true }),
    onSuccess: () => {
      onSaved(t('employees.reactivated'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
    },
    onError: () => onError(t('employees.saveFailed')),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Drop the empty-string password rather than sending it — the API will
    // 400 a too-short password if we forward "".
    const { password, ...rest } = form;
    const payload: UpdateEmployeeInput = { ...rest };
    if (password && password.length >= 6) {
      (payload as UpdateEmployeeInput & { password?: string }).password = password;
    }
    updateMut.mutate(payload);
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <div style={formGrid}>
        <FieldText
          label={t('employees.field.name')}
          value={form.name ?? ''}
          onChange={(v) => setForm({ ...form, name: v })}
          required
        />
        <FieldText
          label={t('employees.field.email')}
          value={form.email ?? ''}
          onChange={(v) => setForm({ ...form, email: v })}
          type="email"
          required
        />
        <FieldText
          label={t('employees.field.passwordChange')}
          value={form.password ?? ''}
          onChange={(v) => setForm({ ...form, password: v })}
          type="password"
          minLength={6}
        />
        <FieldSelect
          label={t('employees.field.role')}
          value={form.role ?? 'CASHIER'}
          onChange={(v) => setForm({ ...form, role: v as UserRole })}
          options={ROLES.map((r) => ({
            value: r,
            label: t(`role.${r.toLowerCase()}` as any),
          }))}
        />
        <FieldText
          label={t('employees.field.position')}
          value={form.position ?? ''}
          onChange={(v) => setForm({ ...form, position: v || null })}
        />
        <FieldText
          label={t('employees.field.hireDate')}
          type="date"
          value={(form.hire_date as string | null) ?? ''}
          onChange={(v) => setForm({ ...form, hire_date: v || null })}
        />
        <FieldText
          label={t('employees.field.phone')}
          value={form.phone ?? ''}
          onChange={(v) => setForm({ ...form, phone: v || null })}
        />
        <FieldText
          label={t('employees.field.emergency')}
          value={form.emergency_contact ?? ''}
          onChange={(v) => setForm({ ...form, emergency_contact: v || null })}
        />
        <FieldMoney
          label={t('employees.field.weeklySalary')}
          value={form.weekly_salary ?? null}
          onChange={(v) => setForm({ ...form, weekly_salary: v })}
        />
        <FieldText
          label={t('employees.field.notes')}
          value={form.notes ?? ''}
          onChange={(v) => setForm({ ...form, notes: v || null })}
          textarea
        />
      </div>

      <div style={derivedRow}>
        <DerivedStat
          label={t('employees.derived.weekly')}
          value={form.weekly_salary ? formatMoneyPlain(form.weekly_salary) : '—'}
        />
        <DerivedStat
          label={t('employees.derived.daily')}
          value={deriveDailyDisplay(form.weekly_salary)}
        />
        <DerivedStat
          label={t('employees.derived.hourly')}
          value={deriveHourlyDisplay(form.weekly_salary)}
        />
      </div>

      <div style={formFooter}>
        {employee.active ? (
          <button
            type="button"
            style={btnDanger}
            onClick={() => deactivateMut.mutate()}
            disabled={deactivateMut.isPending}
          >
            {t('employees.deactivate')}
          </button>
        ) : (
          <button
            type="button"
            style={btnSecondary}
            onClick={() => reactivateMut.mutate()}
            disabled={reactivateMut.isPending}
          >
            {t('employees.reactivate')}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="submit"
          style={btnPrimary}
          disabled={updateMut.isPending}
        >
          {t('employees.save')}
        </button>
      </div>
    </form>
  );
}

// ─── Schedule tab ────────────────────────────────────────────────────────

function ScheduleTab({ employee }: { employee: EmployeeRecord }) {
  const { t } = useTranslation();

  // Read the recent attendance window (last 30 days) so the manager sees
  // which days the employee actually took off — that IS the schedule today
  // until we add explicit shift fields to the schema.
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 28);
  const query = useQuery({
    queryKey: ['admin', 'attendance', 'recent', employee.id],
    queryFn: () =>
      listAttendance({
        user_id: employee.id,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        limit: 100,
      }),
    staleTime: 30_000,
  });

  const rows = query.data?.items ?? [];

  // Count which weekdays the employee was scheduled off (DAY_OFF) over the
  // window. Sundays first per ISO convention.
  const dayOfTheWeekStats = useMemo(() => {
    const counts: Record<number, { off: number; total: number }> = {};
    for (let i = 0; i < 7; i++) counts[i] = { off: 0, total: 0 };
    for (const r of rows) {
      const d = new Date(r.date);
      const dow = d.getUTCDay();
      counts[dow].total += 1;
      if (r.status === 'DAY_OFF') counts[dow].off += 1;
    }
    return counts;
  }, [rows]);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={formStyle}>
      <div style={derivedRow}>
        <DerivedStat
          label={t('employees.derived.weekly')}
          value={employee.weekly_salary ? formatMoneyPlain(employee.weekly_salary) : '—'}
        />
        <DerivedStat
          label={t('employees.derived.daily')}
          value={deriveDailyDisplay(employee.weekly_salary)}
        />
        <DerivedStat
          label={t('employees.derived.hourly')}
          value={deriveHourlyDisplay(employee.weekly_salary)}
        />
        <DerivedStat
          label={t('employees.field.daysPerWeek')}
          value={String(DEFAULT_DAYS_PER_WEEK)}
        />
        <DerivedStat
          label={t('employees.field.hoursPerDay')}
          value={String(DEFAULT_HOURS_PER_DAY)}
        />
      </div>

      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        {t('employees.scheduleNote')}
      </p>

      <div style={dayGridStyle}>
        {dayLabels.map((label, idx) => {
          const stat = dayOfTheWeekStats[idx];
          const offPct = stat.total === 0 ? 0 : Math.round((stat.off / stat.total) * 100);
          const isOffMostly = offPct >= 50;
          return (
            <div
              key={label}
              style={{
                ...dayCell,
                ...(isOffMostly ? dayCellOff : {}),
              }}
            >
              <span style={dayCellLabel}>{label}</span>
              <span style={dayCellValue}>
                {isOffMostly ? t('attendance.status.DAY_OFF') : '—'}
              </span>
              <span style={dayCellHint}>
                {stat.off}/{stat.total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Attendance tab (per-employee log) ───────────────────────────────────

interface AttendanceTabProps {
  employee: EmployeeRecord;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function AttendanceTab({ employee, onSaved, onError }: AttendanceTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // 14-day rolling window.
  const days = useMemo(() => {
    const out: string[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, []);

  const from = days[0];
  const to = days[days.length - 1];

  const query = useQuery({
    queryKey: ['admin', 'attendance', employee.id, from, to],
    queryFn: () =>
      listAttendance({ user_id: employee.id, from, to, limit: 100 }),
    staleTime: 15_000,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of query.data?.items ?? []) {
      map.set(r.date.slice(0, 10), r);
    }
    return map;
  }, [query.data]);

  const setStatusMut = useMutation({
    mutationFn: async (input: { date: string; status: AttendanceStatus }) => {
      const existing = byDate.get(input.date);
      if (existing) {
        return updateAttendance(existing.id, { status: input.status });
      }
      return createAttendance({
        user_id: employee.id,
        date: input.date,
        status: input.status,
      });
    },
    onSuccess: () => {
      onSaved(t('attendance.saved'));
      queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance', employee.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance', 'week'],
      });
    },
    onError: () => onError(t('attendance.saveFailed')),
  });

  const togglePaidMut = useMutation({
    mutationFn: async (input: { id: string; isPaid: boolean }) =>
      updateAttendance(input.id, { is_paid: input.isPaid }),
    onSuccess: () => {
      onSaved(t('attendance.saved'));
      queryClient.invalidateQueries({
        queryKey: ['admin', 'attendance', employee.id],
      });
    },
    onError: () => onError(t('attendance.saveFailed')),
  });

  return (
    <div style={formStyle}>
      <div style={attLog}>
        {days.map((iso) => {
          const rec = byDate.get(iso);
          const status = rec?.status ?? null;
          return (
            <div key={iso} style={attLogRow}>
              <span style={attLogDate}>{fmtFullDate(iso)}</span>
              <div style={attLogActions}>
                {(['PRESENT', 'LATE', 'ABSENT', 'DAY_OFF'] as AttendanceStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusMut.mutate({ date: iso, status: s })}
                    disabled={setStatusMut.isPending}
                    style={{
                      ...attChip,
                      ...(status === s ? attChipFor(s) : {}),
                    }}
                  >
                    {t(`attendance.status.${s}` as any)}
                  </button>
                ))}
                {rec?.status === 'ABSENT' && (
                  <button
                    type="button"
                    onClick={() =>
                      togglePaidMut.mutate({ id: rec.id, isPaid: !rec.is_paid })
                    }
                    style={{
                      ...attChip,
                      ...(rec.is_paid ? attChipFor('PRESENT') : {}),
                    }}
                  >
                    {rec.is_paid ? t('attendance.isPaidShort') : t('attendance.unpaid')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Payroll tab ─────────────────────────────────────────────────────────

function PayrollTab({ employee }: { employee: EmployeeRecord }) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'payroll', 'byEmployee', employee.id],
    queryFn: () => listPayroll({ user_id: employee.id, limit: 12 }),
    staleTime: 30_000,
  });

  const rows = query.data?.items ?? [];

  if (query.isLoading) {
    return (
      <div style={spinnerWrap}>
        <Spinner />
      </div>
    );
  }
  if (rows.length === 0) {
    return <div style={emptyState}>{t('payroll.empty')}</div>;
  }

  return (
    <div style={formStyle}>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        {t('employees.payrollNote')}
      </p>
      <div style={{ ...tableWrap, marginTop: 0 }}>
        <div style={{ ...tableHead, gridTemplateColumns: '1fr 90px 90px 110px 90px' }}>
          <span>{t('payroll.col.week')}</span>
          <span style={cellNumHead}>{t('payroll.col.worked')}</span>
          <span style={cellNumHead}>{t('payroll.col.unpaid')}</span>
          <span style={cellNumHead}>{t('payroll.col.net')}</span>
          <span>{t('payroll.col.status')}</span>
        </div>
        {rows.map((r: PayrollPeriod) => (
          <div
            key={r.id}
            style={{ ...tableRow, gridTemplateColumns: '1fr 90px 90px 110px 90px' }}
          >
            <span style={cellMuted}>
              {fmtShortDate(r.week_start)} – {fmtShortDate(r.week_end)}
            </span>
            <span style={cellNum}>{r.days_worked}/{r.days_expected}</span>
            <span style={cellNum}>{r.unpaid_absences}</span>
            <span style={cellNum}>{formatMoneyPlain(r.net_pay)}</span>
            <span>
              <span
                style={{
                  ...statusBadge,
                  ...(r.status === 'PAID'
                    ? statusBadgeOk
                    : r.status === 'APPROVED'
                      ? statusBadgeWarn
                      : statusBadgeNeutral),
                }}
              >
                {t(`payroll.status.${r.status}` as any)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Create employee modal ───────────────────────────────────────────────

interface CreateEmployeeModalProps {
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function CreateEmployeeModal({ onClose, onSaved, onError }: CreateEmployeeModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateEmployeeInput>({
    name: '',
    email: '',
    pin: '',
    password: '',
    role: 'CASHIER',
    weekly_salary: 0,
    position: '',
    phone: '',
  });

  // Esc captured here so it always closes the modal first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const createMut = useMutation({
    mutationFn: (input: CreateEmployeeInput) => createEmployee(input),
    onSuccess: () => onSaved(t('employees.created')),
    onError: () => onError(t('employees.createFailed')),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Clean optional empty strings.
    const payload: CreateEmployeeInput = {
      ...form,
      position: form.position?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
    };
    createMut.mutate(payload);
  }

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={modalTitle}>{t('employees.new')}</h3>
          <button type="button" onClick={onClose} style={drawerClose}>
            ×
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 22px 22px' }}>
          <div style={formGrid}>
            <FieldText
              label={t('employees.field.name')}
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              required
            />
            <FieldText
              label={t('employees.field.email')}
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              type="email"
              required
            />
            <FieldText
              label={t('employees.field.pin')}
              value={form.pin}
              onChange={(v) => setForm({ ...form, pin: v })}
              pattern="\d{4,6}"
              required
            />
            <FieldText
              label={t('employees.field.password')}
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              type="password"
              minLength={6}
              required
            />
            <FieldSelect
              label={t('employees.field.role')}
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v as UserRole })}
              options={ROLES.map((r) => ({
                value: r,
                label: t(`role.${r.toLowerCase()}` as any),
              }))}
            />
            <FieldText
              label={t('employees.field.position')}
              value={form.position ?? ''}
              onChange={(v) => setForm({ ...form, position: v })}
            />
            <FieldText
              label={t('employees.field.hireDate')}
              type="date"
              value={form.hire_date ?? ''}
              onChange={(v) => setForm({ ...form, hire_date: v || undefined })}
            />
            <FieldText
              label={t('employees.field.phone')}
              value={form.phone ?? ''}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <FieldMoney
              label={t('employees.field.weeklySalary')}
              value={form.weekly_salary}
              onChange={(v) => setForm({ ...form, weekly_salary: v ?? 0 })}
            />
          </div>

          <div style={derivedRow}>
            <DerivedStat
              label={t('employees.derived.daily')}
              value={deriveDailyDisplay(form.weekly_salary)}
            />
            <DerivedStat
              label={t('employees.derived.hourly')}
              value={deriveHourlyDisplay(form.weekly_salary)}
            />
          </div>

          <div style={formFooter}>
            <button type="button" style={btnSecondary} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button type="submit" style={btnPrimary} disabled={createMut.isPending}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Form primitives ────────────────────────────────────────────────────

interface FieldTextProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
  pattern?: string;
  textarea?: boolean;
}

function FieldText({
  label,
  value,
  onChange,
  type = 'text',
  required,
  minLength,
  pattern,
  textarea,
}: FieldTextProps) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabel}>{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...textInputStyle, minHeight: 72, paddingTop: 8 }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          pattern={pattern}
          style={textInputStyle}
        />
      )}
    </label>
  );
}

interface FieldSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}

function FieldSelect({ label, value, onChange, options }: FieldSelectProps) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabel}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={textInputStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface FieldMoneyProps {
  label: string;
  value: number | null;
  onChange: (centavos: number | null) => void;
}

function FieldMoney({ label, value, onChange }: FieldMoneyProps) {
  // Money is stored as centavos (integer) but edited in pesos for ergonomics.
  // 2 decimal places — match the rest of the terminal's price inputs.
  const [text, setText] = useState(value === null ? '' : (value / 100).toFixed(2));

  useEffect(() => {
    setText(value === null ? '' : (value / 100).toFixed(2));
  }, [value]);

  function commit(s: string) {
    setText(s);
    if (s.trim() === '') {
      onChange(null);
      return;
    }
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0) {
      onChange(Math.round(n * 100));
    }
  }

  return (
    <label style={fieldStyle}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        value={text}
        onChange={(e) => commit(e.target.value)}
        style={textInputStyle}
      />
    </label>
  );
}

function DerivedStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={derivedCell}>
      <span style={derivedLabel}>{label}</span>
      <span style={derivedValue}>{value}</span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function deriveHourlyDisplay(weeklyRaw: string | number | null | undefined): string {
  if (weeklyRaw === null || weeklyRaw === undefined || weeklyRaw === '') return '—';
  const cents = typeof weeklyRaw === 'number' ? weeklyRaw : Number(weeklyRaw);
  if (!Number.isFinite(cents) || cents <= 0) return '—';
  const hourly = cents / (DEFAULT_DAYS_PER_WEEK * DEFAULT_HOURS_PER_DAY);
  return formatMoneyPlain(Math.round(hourly));
}

function deriveDailyDisplay(weeklyRaw: string | number | null | undefined): string {
  if (weeklyRaw === null || weeklyRaw === undefined || weeklyRaw === '') return '—';
  const cents = typeof weeklyRaw === 'number' ? weeklyRaw : Number(weeklyRaw);
  if (!Number.isFinite(cents) || cents <= 0) return '—';
  const daily = cents / DEFAULT_DAYS_PER_WEEK;
  return formatMoneyPlain(Math.round(daily));
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function attChipFor(status: AttendanceStatus): CSSProperties {
  switch (status) {
    case 'PRESENT':
      return { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' };
    case 'LATE':
      return { background: 'var(--gold)', color: '#2c2420', borderColor: 'var(--gold)' };
    case 'ABSENT':
      return { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' };
    case 'DAY_OFF':
      return { background: 'var(--text2)', color: '#fff', borderColor: 'var(--text2)' };
  }
}

// ─── Local styles (keep next to the component for clarity) ───────────────

const tableWrap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  marginTop: 8,
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 18px',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '14px 18px',
  borderBottom: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderTop: '1px solid var(--border)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  width: '100%',
};

const selectedRow: CSSProperties = {
  background: 'rgba(201,164,92,0.08)',
};

const cellMuted: CSSProperties = { color: 'var(--text2)' };

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text1)',
};

const cellNumHead: CSSProperties = { textAlign: 'right' };

const nameCell: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const nameMain: CSSProperties = { fontWeight: 600, color: 'var(--text1)' };
const nameSub: CSSProperties = { fontSize: 11, color: 'var(--text3)' };

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const statusBadgeOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
};

const statusBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.18)',
  color: 'var(--text2)',
};

const statusBadgeWarn: CSSProperties = {
  background: 'rgba(201,164,92,0.16)',
  color: '#8a6d2a',
};

const statusBadgeNeutral: CSSProperties = {
  background: 'rgba(91,122,140,0.16)',
  color: '#3a566b',
};

const spinnerWrap: CSSProperties = {
  padding: 28,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '36px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const drawerScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 200,
  display: 'flex',
  justifyContent: 'flex-end',
};

const drawerPanel: CSSProperties = {
  width: 'min(680px, 92vw)',
  background: 'var(--bg2)',
  borderLeft: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
  height: '100%',
};

const drawerHead: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const drawerTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const drawerSub: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  marginTop: 4,
};

const drawerClose: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tabRow: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '10px 16px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
};

const tabBtn: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text2)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tabBtnActive: CSSProperties = {
  background: 'var(--bg2)',
  color: 'var(--text1)',
  borderColor: 'var(--border)',
};

const drawerBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '20px 24px 24px',
};

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const textInputStyle: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const derivedRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  padding: '12px 14px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  background: 'rgba(201,164,92,0.05)',
};

const derivedCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 110,
};

const derivedLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const derivedValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
};

const formFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingTop: 4,
};

const btnPrimary: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const btnSecondary: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const btnDanger: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.25)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 250,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: 'min(720px, 92vw)',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
};

const modalHead: CSSProperties = {
  padding: '18px 22px 12px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const dayGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 8,
};

const dayCell: CSSProperties = {
  padding: '10px 8px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'center',
};

const dayCellOff: CSSProperties = {
  background: 'rgba(168,152,136,0.14)',
  borderColor: 'var(--text3)',
};

const dayCellLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text2)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const dayCellValue: CSSProperties = {
  fontSize: 12,
  color: 'var(--text1)',
  fontWeight: 600,
};

const dayCellHint: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
};

const attLog: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg2)',
};

const attLogRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  gap: 10,
};

const attLogDate: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  fontWeight: 600,
};

const attLogActions: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const attChip: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.04em',
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
