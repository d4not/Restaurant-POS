import type { CSSProperties } from 'react';
import type { FloorDecor } from '../../api/floors';
import { HATCH_PATTERN, SELECTION_BLUE, resizeHandle } from './styles';

interface Props {
  decor: FloorDecor;
  editing: boolean;
  selected: boolean;
  // True when tapping the bar in view mode jumps to the takeout/delivery tab.
  // Drives the cursor + the "→ Takeout" chip — without this flag the bar
  // would render the chip even when no takeout zone exists, misleading the
  // operator about what the click does.
  takeoutShortcut?: boolean;
  offset?: { dx: number; dy: number; dw: number; dh: number };
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, mode: 'drag' | 'resize') => void;
  onClick?: (e: React.MouseEvent) => void;
}

// Long hatched rectangle representing a bar/counter. In view mode it doubles
// as a "go to takeout" shortcut — tapping it routes to the takeout/delivery
// tab so the operator can launch a takeout order from where customers
// physically pick up. In edit mode it behaves like other decor (drag/resize).
export function BarCounter({
  decor,
  editing,
  selected,
  takeoutShortcut,
  offset,
  onPointerDown,
  onClick,
}: Props) {
  const left = decor.pos_x + (offset?.dx ?? 0);
  const top = decor.pos_y + (offset?.dy ?? 0);
  const width = Math.max(40, decor.width + (offset?.dw ?? 0));
  const height = Math.max(24, decor.height + (offset?.dh ?? 0));

  const interactive = !editing && takeoutShortcut;

  const root: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width,
    height,
    transform: `rotate(${decor.rotation}deg)`,
    transformOrigin: 'center',
    background: '#fff',
    backgroundImage: HATCH_PATTERN,
    border: '2px solid var(--text1)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: "'Playfair Display', serif",
    fontSize: Math.max(12, Math.min(20, height * 0.32)),
    color: 'var(--text1)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: editing ? 'grab' : interactive ? 'pointer' : 'default',
    userSelect: 'none',
    outline: selected ? `2px solid ${SELECTION_BLUE}` : 'none',
    outlineOffset: selected ? 4 : 0,
    transition: interactive ? 'box-shadow 0.15s, transform 0.15s' : undefined,
    boxShadow: interactive ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
  };

  const chipStyle: CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'none',
    padding: '3px 9px',
    borderRadius: 999,
    background: 'var(--gold)',
    color: '#2c2420',
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      style={root}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e, 'drag');
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      data-decor-id={decor.id}
    >
      <span>{decor.label || 'Bar'}</span>
      {interactive && <span style={chipStyle}>Takeout →</span>}
      {editing && (
        <div
          style={{ ...resizeHandle, right: -6, bottom: -6, cursor: 'nwse-resize' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown?.(e, 'resize');
          }}
        />
      )}
    </div>
  );
}
