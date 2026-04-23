import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FloorTable, FloorZone, TableShape } from '../../types/api';
import { relativeTime } from '../../utils/format';

// The canvas coordinate grid. 20px cell size is loose enough for fat fingers
// and tight enough that tables land flush against each other when aligned.
// Only applied as a visual hint + an optional snap; nothing in the data model
// enforces it, so arbitrary positions are still accepted.
const GRID_SIZE = 20;

function snap(value: number, enabled: boolean): number {
  if (!enabled) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clampRotation(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return Math.round(mod);
}

// ── Drag/resize state machines ──────────────────────────────────────────
// Drag targets are entirely in CSS pixel space so we can compute deltas off
// clientX/clientY without worrying about transforms — the canvas itself is
// a plain scrollable container with absolute-positioned children.

type DragMode =
  | { kind: 'idle' }
  | {
      kind: 'move';
      id: string;
      type: 'table' | 'label';
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    }
  | {
      kind: 'resize';
      id: string;
      type: 'table' | 'label';
      startX: number;
      startY: number;
      origW: number;
      origH: number;
      origX: number;
      origY: number;
      handle: 'se' | 'sw' | 'ne' | 'nw';
    };

export interface FloorCanvasProps {
  zones: FloorZone[];
  editMode: boolean;
  selectedId: string | null;
  selectedKind: 'table' | 'label' | null;
  onSelect: (id: string | null, kind: 'table' | 'label' | null) => void;
  onTableTap: (table: FloorTable) => void;
  onMoveTable: (id: string, pos: { pos_x: number; pos_y: number }) => void;
  onResizeTable: (
    id: string,
    rect: { pos_x: number; pos_y: number; width: number; height: number },
  ) => void;
  onMoveLabel: (id: string, pos: { pos_x: number; pos_y: number }) => void;
  onResizeLabel: (
    id: string,
    rect: { pos_x: number; pos_y: number; width: number; height: number },
  ) => void;
  snapToGrid: boolean;
}

interface DraftRect {
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}

export function FloorCanvas(props: FloorCanvasProps) {
  const {
    zones,
    editMode,
    selectedId,
    selectedKind,
    onSelect,
    onTableTap,
    onMoveTable,
    onResizeTable,
    onMoveLabel,
    onResizeLabel,
    snapToGrid,
  } = props;

  // drafts are the in-flight positions during a drag/resize. They sidestep
  // the round-trip to the server: the final position is committed via the
  // on*Table / on*Label callbacks on pointerup.
  const [tableDrafts, setTableDrafts] = useState<Record<string, DraftRect>>({});
  const [labelDrafts, setLabelDrafts] = useState<Record<string, DraftRect>>({});
  const dragRef = useRef<DragMode>({ kind: 'idle' });
  // suppressTapRef flips to true as soon as a drag starts and back to false
  // on the next tick after pointerup — prevents a drag-ended tap from
  // triggering the table's view-mode order flow.
  const suppressTapRef = useRef(false);

  const allTables = useMemo(
    () =>
      zones.flatMap((z) =>
        z.tables.map((t) => ({ ...t, zone_id: z.id, zone_name: z.name })),
      ),
    [zones],
  );
  const allLabels = useMemo(
    () =>
      zones.flatMap((z) =>
        z.labels.map((l) => ({ ...l, zone_id: z.id, zone_name: z.name })),
      ),
    [zones],
  );

  // Clear stale drafts when the zone data re-arrives (e.g. after a PATCH).
  useEffect(() => {
    setTableDrafts((prev) => {
      const keep: typeof prev = {};
      for (const id of Object.keys(prev)) {
        if (allTables.some((t) => t.id === id)) keep[id] = prev[id];
      }
      return keep;
    });
    setLabelDrafts((prev) => {
      const keep: typeof prev = {};
      for (const id of Object.keys(prev)) {
        if (allLabels.some((l) => l.id === id)) keep[id] = prev[id];
      }
      return keep;
    });
  }, [allTables, allLabels]);

  const tableById = useMemo(() => {
    const m = new Map<string, (typeof allTables)[number]>();
    for (const t of allTables) m.set(t.id, t);
    return m;
  }, [allTables]);

  const labelById = useMemo(() => {
    const m = new Map<string, (typeof allLabels)[number]>();
    for (const l of allLabels) m.set(l.id, l);
    return m;
  }, [allLabels]);

  const beginMove = useCallback(
    (
      e: React.PointerEvent,
      id: string,
      type: 'table' | 'label',
      origX: number,
      origY: number,
    ) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        kind: 'move',
        id,
        type,
        startX: e.clientX,
        startY: e.clientY,
        origX,
        origY,
      };
    },
    [],
  );

  const beginResize = useCallback(
    (
      e: React.PointerEvent,
      id: string,
      type: 'table' | 'label',
      handle: 'se' | 'sw' | 'ne' | 'nw',
      rect: { pos_x: number; pos_y: number; width: number; height: number },
    ) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        kind: 'resize',
        id,
        type,
        startX: e.clientX,
        startY: e.clientY,
        origW: rect.width,
        origH: rect.height,
        origX: rect.pos_x,
        origY: rect.pos_y,
        handle,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const mode = dragRef.current;
      if (mode.kind === 'idle') return;
      suppressTapRef.current = true;
      const dx = e.clientX - mode.startX;
      const dy = e.clientY - mode.startY;
      if (mode.kind === 'move') {
        const next = {
          pos_x: snap(mode.origX + dx, snapToGrid),
          pos_y: snap(mode.origY + dy, snapToGrid),
          width:
            mode.type === 'table'
              ? tableById.get(mode.id)?.width ?? 120
              : labelById.get(mode.id)?.width ?? 200,
          height:
            mode.type === 'table'
              ? tableById.get(mode.id)?.height ?? 120
              : labelById.get(mode.id)?.height ?? 48,
        };
        if (mode.type === 'table') {
          setTableDrafts((prev) => ({ ...prev, [mode.id]: next }));
        } else {
          setLabelDrafts((prev) => ({ ...prev, [mode.id]: next }));
        }
        return;
      }
      if (mode.kind === 'resize') {
        let nx = mode.origX;
        let ny = mode.origY;
        let nw = mode.origW;
        let nh = mode.origH;
        if (mode.handle === 'se') {
          nw = Math.max(40, mode.origW + dx);
          nh = Math.max(40, mode.origH + dy);
        } else if (mode.handle === 'sw') {
          nw = Math.max(40, mode.origW - dx);
          nh = Math.max(40, mode.origH + dy);
          nx = mode.origX + (mode.origW - nw);
        } else if (mode.handle === 'ne') {
          nw = Math.max(40, mode.origW + dx);
          nh = Math.max(40, mode.origH - dy);
          ny = mode.origY + (mode.origH - nh);
        } else if (mode.handle === 'nw') {
          nw = Math.max(40, mode.origW - dx);
          nh = Math.max(40, mode.origH - dy);
          nx = mode.origX + (mode.origW - nw);
          ny = mode.origY + (mode.origH - nh);
        }
        const snapped = {
          pos_x: snap(nx, snapToGrid),
          pos_y: snap(ny, snapToGrid),
          width: snap(nw, snapToGrid),
          height: snap(nh, snapToGrid),
        };
        if (mode.type === 'table') {
          setTableDrafts((prev) => ({ ...prev, [mode.id]: snapped }));
        } else {
          setLabelDrafts((prev) => ({ ...prev, [mode.id]: snapped }));
        }
      }
    },
    [tableById, labelById, snapToGrid],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const mode = dragRef.current;
      if (mode.kind === 'idle') return;
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* no-op */
      }
      dragRef.current = { kind: 'idle' };
      // Reset tap-suppression on the next frame so the click event from the
      // same pointerup doesn't fire the table handler.
      requestAnimationFrame(() => {
        suppressTapRef.current = false;
      });
      const id = mode.id;
      if (mode.kind === 'move') {
        const draft =
          mode.type === 'table' ? tableDrafts[id] : labelDrafts[id];
        if (!draft) return;
        if (mode.type === 'table') {
          onMoveTable(id, { pos_x: draft.pos_x, pos_y: draft.pos_y });
        } else {
          onMoveLabel(id, { pos_x: draft.pos_x, pos_y: draft.pos_y });
        }
      } else if (mode.kind === 'resize') {
        const draft =
          mode.type === 'table' ? tableDrafts[id] : labelDrafts[id];
        if (!draft) return;
        if (mode.type === 'table') {
          onResizeTable(id, draft);
        } else {
          onResizeLabel(id, draft);
        }
      }
    },
    [tableDrafts, labelDrafts, onMoveTable, onMoveLabel, onResizeTable, onResizeLabel],
  );

  // Clicking empty canvas in edit mode clears the selection.
  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!editMode) return;
      if (e.target === e.currentTarget) {
        onSelect(null, null);
      }
    },
    [editMode, onSelect],
  );

  function renderTable(table: (typeof allTables)[number]) {
    const draft = tableDrafts[table.id];
    const x = draft?.pos_x ?? table.pos_x;
    const y = draft?.pos_y ?? table.pos_y;
    const w = draft?.width ?? table.width;
    const h = draft?.height ?? table.height;
    const isSelected = editMode && selectedKind === 'table' && selectedId === table.id;

    const statusClass =
      table.status === 'OCCUPIED'
        ? 'occupied'
        : table.status === 'RESERVED'
          ? 'reserved'
          : 'available';

    const shapeClass: Record<TableShape, string> = {
      TABLE_RECT: 'shape-rect',
      TABLE_CIRCLE: 'shape-circle',
    };

    const displayLabel = table.label ?? String(table.number);

    return (
      <div
        key={table.id}
        className={`canvas-table ${statusClass} ${shapeClass[table.shape]} ${isSelected ? 'selected' : ''} ${editMode ? 'edit' : ''}`}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          transform: `rotate(${table.rotation}deg)`,
        }}
        onPointerDown={(e) => {
          if (!editMode) return;
          onSelect(table.id, 'table');
          beginMove(e, table.id, 'table', x, y);
        }}
        onClick={(e) => {
          if (suppressTapRef.current) return;
          if (editMode) {
            e.stopPropagation();
            onSelect(table.id, 'table');
            return;
          }
          onTableTap(table);
        }}
        role="button"
        aria-label={`Table ${displayLabel}`}
      >
        <div className="ct-body">
          <div className="ct-label">{displayLabel}</div>
          <div className="ct-capacity">{table.capacity} seats</div>
          {table.current_order && (
            <div className="ct-order">
              <span className="ct-order-num">#{table.current_order.order_number}</span>
              <span className="ct-order-time">
                {relativeTime(table.current_order.opened_at)}
              </span>
            </div>
          )}
          {table.current_order?.waiter && (
            <div className="ct-waiter">{table.current_order.waiter.name}</div>
          )}
        </div>
        {isSelected && (
          <>
            <span className="ct-handle nw" onPointerDown={(e) => beginResize(e, table.id, 'table', 'nw', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle ne" onPointerDown={(e) => beginResize(e, table.id, 'table', 'ne', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle sw" onPointerDown={(e) => beginResize(e, table.id, 'table', 'sw', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle se" onPointerDown={(e) => beginResize(e, table.id, 'table', 'se', { pos_x: x, pos_y: y, width: w, height: h })} />
          </>
        )}
      </div>
    );
  }

  function renderLabel(label: (typeof allLabels)[number]) {
    const draft = labelDrafts[label.id];
    const x = draft?.pos_x ?? label.pos_x;
    const y = draft?.pos_y ?? label.pos_y;
    const w = draft?.width ?? label.width;
    const h = draft?.height ?? label.height;
    const isSelected = editMode && selectedKind === 'label' && selectedId === label.id;

    return (
      <div
        key={label.id}
        className={`canvas-label ${isSelected ? 'selected' : ''} ${editMode ? 'edit' : ''}`}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          fontSize: label.font_size,
          transform: `rotate(${label.rotation}deg)`,
        }}
        onPointerDown={(e) => {
          if (!editMode) return;
          onSelect(label.id, 'label');
          beginMove(e, label.id, 'label', x, y);
        }}
        onClick={(e) => {
          if (!editMode) return;
          e.stopPropagation();
          onSelect(label.id, 'label');
        }}
      >
        <span className="cl-text">{label.text}</span>
        {isSelected && (
          <>
            <span className="ct-handle nw" onPointerDown={(e) => beginResize(e, label.id, 'label', 'nw', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle ne" onPointerDown={(e) => beginResize(e, label.id, 'label', 'ne', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle sw" onPointerDown={(e) => beginResize(e, label.id, 'label', 'sw', { pos_x: x, pos_y: y, width: w, height: h })} />
            <span className="ct-handle se" onPointerDown={(e) => beginResize(e, label.id, 'label', 'se', { pos_x: x, pos_y: y, width: w, height: h })} />
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={`floor-canvas ${editMode ? 'edit-mode' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseDown={onCanvasMouseDown}
    >
      {allLabels.map(renderLabel)}
      {allTables.map(renderTable)}
    </div>
  );
}

export { GRID_SIZE, snap, clampRotation };
