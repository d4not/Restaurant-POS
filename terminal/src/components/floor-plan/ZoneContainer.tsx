import type { CSSProperties, ReactNode } from 'react';
import { SELECTION_BLUE, resizeHandle, zoneLabel, zoneMeta } from './styles';

interface Props {
  id: string;
  name: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  // `transform` applies a per-zone scale when a specific zone tab is focused
  // (so the chosen zone fills the viewport). Identity in the all-zones view.
  transform?: string;
  // When the canvas is focused on a different zone, non-target zones fade out.
  faded?: boolean;
  metaText: string;
  editing: boolean;
  selected: boolean;
  // Pixel offset applied during a live drag/resize on the zone itself.
  offset?: { dx: number; dy: number; dw: number; dh: number };
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, mode: 'drag' | 'resize') => void;
  onClick?: (e: React.MouseEvent) => void;
  children: ReactNode;
}

export function ZoneContainer({
  name,
  pos_x,
  pos_y,
  width,
  height,
  transform,
  faded,
  metaText,
  editing,
  selected,
  offset,
  onPointerDown,
  onClick,
  children,
}: Props) {
  const left = pos_x + (offset?.dx ?? 0);
  const top = pos_y + (offset?.dy ?? 0);
  const w = Math.max(120, width + (offset?.dw ?? 0));
  const h = Math.max(120, height + (offset?.dh ?? 0));

  const root: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: w,
    height: h,
    border: editing
      ? selected
        ? `2px solid ${SELECTION_BLUE}`
        : '1px solid #c9c2b1'
      : '1px dashed #c9c2b1',
    borderRadius: 10,
    boxSizing: 'border-box',
    background: 'transparent',
    transformOrigin: '0 0',
    transform,
    transition:
      'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease, border-color 0.12s',
    opacity: faded ? 0 : 1,
    pointerEvents: faded ? 'none' : 'auto',
    boxShadow: selected ? `0 0 0 1px ${SELECTION_BLUE}` : 'none',
    cursor: editing ? 'grab' : 'default',
  };

  return (
    <div
      style={root}
      data-zone-id={name}
      // Zone drag fires from anywhere on the zone — including the label, meta,
      // dashed border, or empty interior. Tables and decor inside stop their
      // own pointerdown propagation so child clicks don't double-fire.
      onPointerDown={(e) => onPointerDown?.(e, 'drag')}
      onClick={(e) => onClick?.(e)}
    >
      {/* Label/meta are visual chrome — clicks pass through to the zone div
          behind them so the user can grab the zone from anywhere along its
          border, including where the label sits over the dashed line. */}
      <div style={{ ...zoneLabel, pointerEvents: 'none' }}>{name}</div>
      <div style={{ ...zoneMeta, pointerEvents: 'none' }}>{metaText}</div>
      {children}
      {editing && selected && (
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
