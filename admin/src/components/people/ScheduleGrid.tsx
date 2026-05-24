import type { CSSProperties } from 'react';
import type { RosterRow, ScheduleSlot, Week } from '../../types/people';
import { useTranslation } from '../../i18n';
import { EmployeeAvatar } from './EmployeeAvatar';

interface CellPayload {
  userId: string;
  dayOfWeek: number;
  slot: ScheduleSlot | null;
}

type Props =
  | {
      mode: 'single';
      userId: string;
      week: Week | undefined;
      onCellClick?: (payload: CellPayload) => void;
      readOnly?: boolean;
    }
  | {
      mode: 'roster';
      roster: RosterRow[];
      onCellClick?: (payload: CellPayload) => void;
      readOnly?: boolean;
    };

/** Mon..Sun day keys for i18n. */
const DAY_KEYS = [
  'people.schedule.dayMon',
  'people.schedule.dayTue',
  'people.schedule.dayWed',
  'people.schedule.dayThu',
  'people.schedule.dayFri',
  'people.schedule.daySat',
  'people.schedule.daySun',
] as const;

export function formatTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const cellBase: CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  border: '1px dashed var(--border)',
  padding: '8px 10px',
  minHeight: 56,
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 2,
  fontFamily: 'inherit',
  transition: 'background 0.12s, border-color 0.12s',
};

const cellFilled: CSSProperties = {
  ...cellBase,
  background: 'var(--gold-bg)',
  border: '1px solid var(--gold)',
  color: 'var(--text)',
};

const cellInactive: CSSProperties = {
  ...cellFilled,
  background: 'rgba(154,124,90,0.10)',
  borderColor: 'var(--border2)',
  color: 'var(--text3)',
  textDecoration: 'line-through',
};

const headerCell: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  padding: '0 4px 8px',
  textAlign: 'center',
};

function ScheduleCell({
  slot,
  onClick,
  readOnly,
}: {
  slot: ScheduleSlot | null;
  onClick?: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  if (!slot) {
    return (
      <button
        type="button"
        style={{
          ...cellBase,
          cursor: readOnly ? 'default' : 'pointer',
          color: 'var(--text3)',
        }}
        onClick={readOnly ? undefined : onClick}
        disabled={readOnly}
      >
        <span style={{ fontSize: 11 }}>{readOnly ? '—' : `+ ${t('people.schedule.addSlot')}`}</span>
      </button>
    );
  }
  const style = slot.active ? cellFilled : cellInactive;
  return (
    <button
      type="button"
      style={{ ...style, cursor: readOnly ? 'default' : 'pointer' }}
      onClick={readOnly ? undefined : onClick}
      disabled={readOnly}
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>
        {formatTime(slot.start_minutes)} – {formatTime(slot.end_minutes)}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>
        {Math.round((slot.end_minutes - slot.start_minutes) / 6) / 10}h
      </span>
    </button>
  );
}

export function ScheduleGrid(props: Props) {
  const { t } = useTranslation();
  const readOnly = props.readOnly ?? false;

  // 7-day header — used by both single and roster modes.
  const headerRow = (
    <>
      {DAY_KEYS.map((k) => (
        <div key={k} style={headerCell}>{t(k)}</div>
      ))}
    </>
  );

  if (props.mode === 'single') {
    const week = props.week ?? Array(7).fill(null);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {headerRow}
        {Array.from({ length: 7 }).map((_, day) => {
          const slot = week[day] ?? null;
          return (
            <ScheduleCell
              key={day}
              slot={slot}
              readOnly={readOnly}
              onClick={() =>
                props.onCellClick?.({
                  userId: props.userId,
                  dayOfWeek: day,
                  slot,
                })
              }
            />
          );
        })}
      </div>
    );
  }

  // ── Roster mode ──
  const { roster } = props;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px repeat(7, minmax(110px, 1fr))',
          gap: 8,
          minWidth: 920,
        }}
      >
        <div style={headerCell} />
        {headerRow}
        {roster.map((row) => (
          <RosterUserRow
            key={row.user_id}
            row={row}
            readOnly={readOnly}
            onCellClick={props.onCellClick}
          />
        ))}
        {roster.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '36px 12px',
              color: 'var(--text3)',
              fontSize: 13,
            }}
          >
            {t('people.schedule.empty')}
          </div>
        )}
      </div>
    </div>
  );
}

function RosterUserRow({
  row,
  readOnly,
  onCellClick,
}: {
  row: RosterRow;
  readOnly: boolean;
  onCellClick?: (payload: CellPayload) => void;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
        }}
      >
        <EmployeeAvatar name={row.user_name} role={row.role} size={32} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.user_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {row.position ?? row.role}
          </div>
        </div>
      </div>
      {Array.from({ length: 7 }).map((_, day) => {
        const slot = row.week[day] ?? null;
        return (
          <ScheduleCell
            key={`${row.user_id}-${day}`}
            slot={slot}
            readOnly={readOnly}
            onClick={() =>
              onCellClick?.({
                userId: row.user_id,
                dayOfWeek: day,
                slot,
              })
            }
          />
        );
      })}
    </>
  );
}
