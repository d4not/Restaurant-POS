// Read-only weekly roster. Edits live in the admin web — this view just
// surfaces the current week so the manager can answer "who's on tonight?"
// at the terminal without task-switching to a laptop.
//
// Layout
//   AdminViewShell
//   ├─ Edit-hint banner (gold, italic)
//   └─ Grid (sticky-left employee column · 7 day columns Mon-Sun)

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listRoster, type RosterRow, type ScheduleSlot } from '../../../api/schedule';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';

interface ScheduleReadViewProps {
  onBack: () => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtSlot(slot: ScheduleSlot): string {
  return `${fmtMinutes(slot.start_minutes)} – ${fmtMinutes(slot.end_minutes)}`;
}

export function ScheduleReadView({ onBack }: ScheduleReadViewProps) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'schedule', 'roster'],
    queryFn: () => listRoster(),
    staleTime: 30_000,
  });

  const rows: RosterRow[] = query.data ?? [];
  // Stable order: alpha by name keeps the grid scannable between renders.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.user_name.localeCompare(b.user_name)),
    [rows],
  );

  return (
    <AdminViewShell
      titleKey="admin.scheduleRead.title"
      subtitleKey="admin.scheduleRead.subtitle"
      onBack={onBack}
    >
      <div style={hintBanner}>{t('admin.scheduleRead.editHint')}</div>

      {query.isLoading ? (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      ) : sorted.length === 0 ? (
        <div style={emptyState}>{t('admin.scheduleRead.empty')}</div>
      ) : (
        <div style={gridWrap}>
          <div style={gridHead}>
            <span style={gridHeadEmployee}>{t('attendance.col.employee')}</span>
            {DAY_LABELS.map((label) => (
              <span key={label} style={gridHeadDay}>
                {label}
              </span>
            ))}
          </div>
          {sorted.map((row) => (
            <div key={row.user_id} style={gridRow}>
              <span style={gridRowEmployee}>
                <span style={empName}>{row.user_name}</span>
                <span style={empSub}>{row.position || row.role}</span>
              </span>
              {row.week.map((slot, idx) => (
                <span key={idx} style={cellWrap}>
                  {slot ? (
                    <span
                      style={{
                        ...slotPill,
                        ...(slot.active ? {} : slotPillMuted),
                      }}
                      title={slot.active ? undefined : t('admin.scheduleRead.inactive')}
                    >
                      {fmtSlot(slot)}
                    </span>
                  ) : (
                    <span style={emptySlot}>—</span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Local styles ──────────────────────────────────────────────────────────

const hintBanner: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(201,164,92,0.10)',
  border: '1px solid rgba(201,164,92,0.30)',
  color: 'var(--gold)',
  fontSize: 13,
  fontStyle: 'italic',
  marginBottom: 18,
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
  padding: '14px 16px',
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

const cellWrap: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: 36,
};

const slotPill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 10px',
  borderRadius: 8,
  background: 'rgba(201,164,92,0.12)',
  color: 'var(--text1)',
  border: '1px solid rgba(201,164,92,0.30)',
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

const slotPillMuted: CSSProperties = {
  background: 'rgba(168,152,136,0.10)',
  color: 'var(--text3)',
  borderColor: 'var(--border)',
  textDecoration: 'line-through',
};

const emptySlot: CSSProperties = {
  color: 'var(--text3)',
  fontSize: 14,
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
