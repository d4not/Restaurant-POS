import type { CSSProperties } from 'react';

// Shared style tokens for the floor-plan canvas. The terminal already exposes
// the warm-light palette in :root; these are the floor-plan-specific shapes
// (dashed borders, hatched bar pattern, blue selection outline) that don't
// belong in the global CSS.

export const SELECTION_BLUE = '#4a90e2';

// Status border colors for the four-state legend (available / occupied /
// attention / reserved). Match the wireframe's palette so the four legend
// dots line up visually with the table borders.
export const STATUS_COLORS = {
  available: 'var(--green)',
  occupied: 'var(--gold)',
  attention: 'var(--red)',
  reserved: '#3a566b',
} as const;

export const zoneShell = (focused: boolean): CSSProperties => ({
  position: 'absolute',
  border: focused ? '1px solid #c9c2b1' : '1px dashed #c9c2b1',
  borderRadius: 10,
  background: 'transparent',
  boxSizing: 'border-box',
  transformOrigin: '0 0',
  transition:
    'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease, border-color 0.12s, box-shadow 0.12s',
});

export const zoneSelectionShell = (selected: boolean): CSSProperties =>
  selected
    ? {
        outline: `2px solid ${SELECTION_BLUE}`,
        outlineOffset: 4,
      }
    : {};

export const zoneLabel: CSSProperties = {
  position: 'absolute',
  top: -11,
  left: 14,
  background: 'var(--bg)',
  padding: '0 10px',
  fontFamily: "'Playfair Display', serif",
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text2)',
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
};

export const zoneMeta: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 14,
  fontSize: 11,
  color: 'var(--text2)',
};

// Hatched stripe pattern matching the wireframe's bar-counter look. Used as
// a backgroundImage so it pairs cleanly with a solid base color.
export const HATCH_PATTERN =
  'repeating-linear-gradient(45deg, transparent 0, transparent 8px, rgba(0,0,0,0.04) 8px, rgba(0,0,0,0.04) 9px)';

export const resizeHandle: CSSProperties = {
  position: 'absolute',
  width: 10,
  height: 10,
  background: '#fff',
  border: `2px solid ${SELECTION_BLUE}`,
  borderRadius: 2,
  zIndex: 5,
};
