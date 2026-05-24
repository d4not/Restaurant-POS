// Quick single-employee absence form. Built for the cashier mid-service who
// just took a "I'm not coming in" call and needs to log it without hunting
// the right cell in the weekly grid.
//
// Layout
//   AdminViewShell
//   └─ Card
//       ├─ Employee picker (search-as-you-type + chip)
//       ├─ Date picker (±1 day arrows; today by default, ±7 day window)
//       ├─ Status segmented control (ABSENT / LATE / DAY_OFF / PRESENT)
//       ├─ Reason textarea (optional)
//       ├─ Paid toggle (only when status=ABSENT)
//       ├─ Error banner
//       └─ Submit (full-width gold)

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createAttendance,
  type AttendanceStatus,
} from '../../../api/attendance';
import { listEmployees, type EmployeeRecord } from '../../../api/employees';
import { ApiError } from '../../../api/client';
import { useTranslation } from '../../../i18n';
import { useHaptics } from '../../../hooks/useHaptics';
import { useToast } from '../../Toast';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';

interface QuickAbsenceViewProps {
  onBack: () => void;
}

// Today / yesterday / etc. — clamped to a 7-day past window so the picker
// never lets the cashier back-date by a month without going through the
// weekly grid (which is the audit-safe surface for that).
const PAST_WINDOW_DAYS = 7;

function todayIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const STATUS_OPTIONS: Array<{
  value: AttendanceStatus;
  color: string;
  bg: string;
  labelKey: string;
}> = [
  { value: 'ABSENT', color: 'var(--red)', bg: 'rgba(196,80,64,0.10)', labelKey: 'admin.quickAbsence.statusAbsent' },
  { value: 'LATE', color: 'var(--gold)', bg: 'rgba(201,164,92,0.14)', labelKey: 'admin.quickAbsence.statusLate' },
  { value: 'DAY_OFF', color: 'var(--text2)', bg: 'rgba(168,152,136,0.14)', labelKey: 'admin.quickAbsence.statusDayOff' },
  { value: 'PRESENT', color: 'var(--green)', bg: 'rgba(74,140,92,0.10)', labelKey: 'admin.quickAbsence.statusPresent' },
];

export function QuickAbsenceView({ onBack }: QuickAbsenceViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();

  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [date, setDate] = useState<string>(todayIso());
  const [status, setStatus] = useState<AttendanceStatus>('ABSENT');
  const [reason, setReason] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const today = useMemo(() => todayIso(), []);
  const minDate = useMemo(() => shiftIso(today, -PAST_WINDOW_DAYS), [today]);

  const employeesQuery = useQuery({
    queryKey: ['admin', 'employees', { active: true, qa: true }],
    queryFn: () => listEmployees({ active: true, limit: 100 }),
    staleTime: 60_000,
  });
  const allEmployees: EmployeeRecord[] = employeesQuery.data?.items ?? [];

  // Match against name + position + email. Trimmed and lowercased on both
  // sides; first 10 hits are enough for a café-scale roster.
  const matches = useMemo(() => {
    if (employee || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return allEmployees
      .filter((e) => {
        const haystack = `${e.name} ${e.position ?? ''} ${e.email}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [allEmployees, search, employee]);

  const createMut = useMutation({
    mutationFn: createAttendance,
    onSuccess: (_rec) => {
      haptics.success();
      const label = STATUS_OPTIONS.find((o) => o.value === status);
      const statusLabel = label ? t(label.labelKey) : status;
      toast.success(
        t('admin.quickAbsence.saved')
          .replace('{name}', employee?.name ?? '')
          .replace('{date}', fmtDateLong(date))
          .replace('{status}', statusLabel),
      );
      // Reset form to defaults but keep the date — staff often log multiple
      // absences for the same day in a row.
      setEmployee(null);
      setSearch('');
      setStatus('ABSENT');
      setReason('');
      setIsPaid(true);
      setErrorText(null);
    },
    onError: (err) => {
      haptics.error();
      setErrorText(
        err instanceof ApiError ? err.message : t('common.unknownError'),
      );
    },
  });

  function submit() {
    if (!employee) {
      setErrorText(t('admin.quickAbsence.pickEmployee'));
      return;
    }
    setErrorText(null);
    createMut.mutate({
      user_id: employee.id,
      date,
      status,
      reason: reason.trim() || undefined,
      is_paid: status === 'ABSENT' ? isPaid : undefined,
    });
  }

  return (
    <AdminViewShell
      titleKey="admin.quickAbsence.title"
      subtitleKey="admin.quickAbsence.subtitle"
      onBack={onBack}
    >
      <div style={card}>
        {/* ─── Employee picker ─────────────────────────────────────────── */}
        <div style={field}>
          <label style={fieldLabel}>{t('admin.quickAbsence.pickEmployee')}</label>
          {employee ? (
            <div style={chip}>
              <span style={chipName}>{employee.name}</span>
              <span style={chipMeta}>
                {employee.position || employee.role}
              </span>
              <button
                type="button"
                onClick={() => {
                  setEmployee(null);
                  setSearch('');
                }}
                style={chipClear}
                aria-label={t('common.remove')}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.quickAbsence.searchPlaceholder')}
                style={textInput}
                autoFocus
              />
              {employeesQuery.isLoading && (
                <div style={spinnerWrap}>
                  <Spinner size={14} />
                </div>
              )}
              {!employeesQuery.isLoading && search.trim() && matches.length === 0 && (
                <div style={pickerEmpty}>{t('common.noResults')}</div>
              )}
              {matches.length > 0 && (
                <div style={pickerList}>
                  {matches.map((emp) => (
                    <button
                      type="button"
                      key={emp.id}
                      onClick={() => {
                        setEmployee(emp);
                        setSearch('');
                      }}
                      style={pickerRow}
                    >
                      <span style={pickerRowName}>{emp.name}</span>
                      <span style={pickerRowMeta}>
                        {emp.position || emp.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── Date picker ─────────────────────────────────────────────── */}
        <div style={field}>
          <label style={fieldLabel}>{t('admin.quickAbsence.date')}</label>
          <div style={dateRow}>
            <button
              type="button"
              style={{ ...dateNav, ...(date <= minDate ? dateNavDisabled : {}) }}
              onClick={() => date > minDate && setDate(shiftIso(date, -1))}
              disabled={date <= minDate}
              aria-label={t('common.previous')}
            >
              ‹
            </button>
            <div style={dateLabel}>{fmtDateLong(date)}</div>
            <button
              type="button"
              style={{ ...dateNav, ...(date >= today ? dateNavDisabled : {}) }}
              onClick={() => date < today && setDate(shiftIso(date, 1))}
              disabled={date >= today}
              aria-label={t('common.next')}
            >
              ›
            </button>
            <button
              type="button"
              style={dateTodayBtn}
              onClick={() => setDate(today)}
              disabled={date === today}
            >
              {t('admin.quickAbsence.today')}
            </button>
          </div>
        </div>

        {/* ─── Status segmented ────────────────────────────────────────── */}
        <div style={field}>
          <label style={fieldLabel}>{t('admin.quickAbsence.status')}</label>
          <div style={segRow}>
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  style={{
                    ...segBtn,
                    ...(active
                      ? {
                          background: opt.color,
                          color: '#fff',
                          borderColor: opt.color,
                          boxShadow: `0 0 0 3px ${opt.bg}`,
                        }
                      : {}),
                  }}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Reason textarea ─────────────────────────────────────────── */}
        <div style={field}>
          <label style={fieldLabel}>
            {t('admin.quickAbsence.reason')}{' '}
            <span style={fieldOpt}>· {t('common.optional')}</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            maxLength={200}
            rows={3}
            style={textArea}
          />
          <div style={charCount}>{reason.length}/200</div>
        </div>

        {/* ─── Paid toggle (only when ABSENT) ──────────────────────────── */}
        {status === 'ABSENT' && (
          <div style={{ ...field, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setIsPaid((v) => !v)}
              style={{
                ...toggleTrack,
                background: isPaid ? 'var(--green)' : '#cdc5b8',
                boxShadow: isPaid ? 'none' : 'inset 0 1px 3px rgba(0,0,0,0.1)',
              }}
              role="switch"
              aria-checked={isPaid}
            >
              <span
                style={{
                  ...toggleThumb,
                  transform: isPaid ? 'translateX(22px)' : 'translateX(2px)',
                }}
              />
            </button>
            <span style={toggleLabel}>{t('admin.quickAbsence.paid')}</span>
          </div>
        )}

        {/* ─── Error + submit ──────────────────────────────────────────── */}
        {errorText && <div style={errBanner}>{errorText}</div>}

        <button
          type="button"
          style={{
            ...submitBtn,
            ...(createMut.isPending || !employee ? submitBtnDisabled : {}),
          }}
          onClick={submit}
          disabled={createMut.isPending || !employee}
        >
          {createMut.isPending ? <Spinner size={14} /> : t('admin.quickAbsence.submit')}
        </button>
      </div>
    </AdminViewShell>
  );
}

// ─── Local styles ──────────────────────────────────────────────────────────

const card: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  maxWidth: 620,
};

const field: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const fieldOpt: CSSProperties = {
  textTransform: 'none',
  letterSpacing: 0,
  color: 'var(--text3)',
  fontWeight: 500,
};

const textInput: CSSProperties = {
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  padding: '0 12px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const textArea: CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  resize: 'vertical',
  minHeight: 70,
};

const charCount: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  textAlign: 'right',
};

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px 10px 14px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 999,
  alignSelf: 'flex-start',
  minHeight: 44,
};

const chipName: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
};

const chipMeta: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
};

const chipClear: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--border)',
  color: 'var(--text1)',
  fontSize: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

const pickerList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  marginTop: 4,
  maxHeight: 280,
  overflowY: 'auto',
};

const pickerRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 14px',
  background: 'var(--bg2)',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 48,
  color: 'var(--text1)',
};

const pickerRowName: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
};

const pickerRowMeta: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
};

const pickerEmpty: CSSProperties = {
  padding: '14px 12px',
  fontSize: 12,
  color: 'var(--text3)',
  textAlign: 'center',
};

const spinnerWrap: CSSProperties = {
  padding: 16,
  display: 'flex',
  justifyContent: 'center',
};

const dateRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const dateNav: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  fontSize: 20,
  color: 'var(--text1)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const dateNavDisabled: CSSProperties = {
  opacity: 0.3,
  cursor: 'not-allowed',
};

const dateLabel: CSSProperties = {
  flex: 1,
  textAlign: 'center',
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
};

const dateTodayBtn: CSSProperties = {
  padding: '0 14px',
  height: 44,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const segRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

const segBtn: CSSProperties = {
  padding: '12px 8px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 48,
  transition: 'all 120ms ease',
};

const toggleTrack: CSSProperties = {
  position: 'relative',
  width: 52,
  height: 32,
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  transition: 'background 200ms ease, box-shadow 200ms ease',
  flexShrink: 0,
};

const toggleThumb: CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 2px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)',
  transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const toggleLabel: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text1)',
};

const errBanner: CSSProperties = {
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.3)',
  color: 'var(--red)',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 500,
};

const submitBtn: CSSProperties = {
  marginTop: 4,
  height: 52,
  borderRadius: 12,
  border: 'none',
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const submitBtnDisabled: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};
