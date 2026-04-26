import type { CSSProperties } from 'react';
import type { FloorDecor } from '../../api/floors';
import { SELECTION_BLUE, resizeHandle } from './styles';

interface Props {
  decor: FloorDecor;
  editing: boolean;
  selected: boolean;
  offset?: { dx: number; dy: number; dw: number; dh: number };
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, mode: 'drag' | 'resize') => void;
  onClick?: (e: React.MouseEvent) => void;
}

// Small green dot used as visual flavor (a plant pot in the corner of a
// terrace, etc.). Always renders as a circle regardless of width/height ratio
// — the data carries `width`/`height` so the inspector can resize it freely
// even though the rendered shape is symmetric.
export function DecorPlant({ decor, editing, selected, offset, onPointerDown, onClick }: Props) {
  const left = decor.pos_x + (offset?.dx ?? 0);
  const top = decor.pos_y + (offset?.dy ?? 0);
  const size = Math.max(
    16,
    Math.min(decor.width, decor.height) + Math.min(offset?.dw ?? 0, offset?.dh ?? 0),
  );

  const root: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'rgba(74,140,92,0.18)',
    border: '1px solid rgba(74,140,92,0.45)',
    cursor: editing ? 'grab' : 'default',
    userSelect: 'none',
    outline: selected ? `2px solid ${SELECTION_BLUE}` : 'none',
    outlineOffset: selected ? 4 : 0,
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
