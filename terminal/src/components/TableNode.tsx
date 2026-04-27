import type { CSSProperties } from 'react';
import type { FloorTable } from '../api/floors';
import { formatElapsed, formatMoney, minutesSince } from '../utils/format';

interface Props {
  table: FloorTable;
  // Edit-mode toggles affect drag interaction + visible chrome.
  editing: boolean;
  selected: boolean;
  attention: boolean;
  // Pixel offset applied during a live drag/resize so we can render at the
  // pointer position without re-saving on every mousemove.
  offset?: { dx: number; dy: number; dw: number; dh: number };
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, mode: 'drag' | 'resize') => void;
  onClick?: (e: React.MouseEvent) => void;
}

interface ChromeColors {
  border: string;
  bg: string;
  fg: string;
  accent: string;
  badge: string;
}

function colorsFor(table: FloorTable, attention: boolean): ChromeColors {
  if (attention) {
    return {
      border: 'var(--red)',
      bg: 'rgba(196,80,64,0.22)',
      fg: 'var(--text1)',
      accent: 'var(--red)',
      badge: 'rgba(196,80,64,0.16)',
    };
  }
  if (table.status === 'OCCUPIED' || table.current_order) {
    return {
      border: 'var(--gold)',
      bg: 'rgba(201,164,92,0.28)',
      fg: 'var(--text1)',
      accent: 'var(--gold)',
      badge: 'rgba(201,164,92,0.16)',
    };
  }
  if (table.status === 'RESERVED') {
    return {
      border: '#3a566b',
      bg: 'rgba(91,122,140,0.18)',
      fg: 'var(--text1)',
      accent: '#3a566b',
      badge: 'rgba(91,122,140,0.16)',
    };
  }
  return {
    border: 'var(--green)',
    bg: 'var(--bg2)',
    fg: 'var(--text1)',
    accent: 'var(--green)',
    badge: 'rgba(74,140,92,0.10)',
  };
}

export function TableNode({
  table,
  editing,
  selected,
  attention,
  offset,
  onPointerDown,
  onClick,
}: Props) {
  const left = table.pos_x + (offset?.dx ?? 0);
  const top = table.pos_y + (offset?.dy ?? 0);
  const width = Math.max(40, table.width + (offset?.dw ?? 0));
  const height = Math.max(40, table.height + (offset?.dh ?? 0));

  const colors = colorsFor(table, attention);
  const isCircle = table.shape === 'TABLE_CIRCLE';
  const order = table.current_order;
  const minutes = order ? minutesSince(order.opened_at) : 0;

  const isOccupied = !!order || table.status === 'OCCUPIED';
  const root: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width,
    height,
    transform: `rotate(${table.rotation}deg)`,
    transformOrigin: 'center',
    background: colors.bg,
    border: `${isOccupied || attention ? 3 : 2}px solid ${colors.border}`,
    borderRadius: isCircle ? '50%' : 14,
    boxShadow: selected
      ? '0 0 0 3px rgba(201,164,92,0.35), var(--shadow)'
      : 'var(--shadow-sm)',
    color: colors.fg,
    cursor: editing ? 'grab' : 'pointer',
    userSelect: 'none',
    overflow: 'hidden',
    transition: editing ? 'none' : 'box-shadow 0.15s, transform 0.15s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    textAlign: 'center',
  };

  const minDim = Math.min(width, height);
  // Hide secondary copy on tightly-scaled tables — the number alone has to
  // carry the cell. Threshold tuned so a typical 100×100 table at ~0.6 zoom
  // (i.e. ~60px on screen) drops the chrome and just shows the digits.
  const dense = minDim < 78;

  const number: CSSProperties = {
    fontFamily: "'Playfair Display', serif",
    fontSize: Math.min(34, Math.max(18, minDim * 0.34)),
    fontWeight: 700,
    color: colors.fg,
    lineHeight: 1,
    marginBottom: dense ? 0 : 4,
  };

  const subStyle: CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  };

  const occupiedStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    marginTop: 2,
  };

  const resizeHandle: CSSProperties = {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: 'var(--gold)',
    border: '2px solid #fff',
    cursor: 'nwse-resize',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
  };

  return (
    <div
      style={root}
      onPointerDown={(e) => {
        // Stop the parent zone from also receiving this pointerdown — otherwise
        // dragging a table would simultaneously start a zone drag.
        e.stopPropagation();
        onPointerDown?.(e, 'drag');
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      data-table-id={table.id}
    >
      <div style={number}>{table.label || table.number}</div>

      {!order && !editing && !dense && (
        <div style={{ ...subStyle, color: 'var(--text3)', letterSpacing: '0.06em' }}>
          {table.status === 'RESERVED' ? 'Reserved' : `seats ${table.capacity}`}
        </div>
      )}

      {order && (
        <div style={occupiedStyle}>
          <span style={{ color: colors.accent, fontWeight: 700, fontSize: dense ? 12 : 13 }}>
            {formatElapsed(minutes)}
          </span>
          {!dense && (
            <>
              {order.waiter && <span>{order.waiter.name}</span>}
              <span style={{ fontWeight: 600, color: 'var(--text1)' }}>
                {formatMoney(order.total)}
              </span>
            </>
          )}
        </div>
      )}

      {editing && (
        <div
          style={resizeHandle}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown?.(e, 'resize');
          }}
        />
      )}
    </div>
  );
}
