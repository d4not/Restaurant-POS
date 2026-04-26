import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrder, fetchActiveOrders, type ActiveOrder } from '../api/orders';
import { fetchFloors, type FloorTable, type FloorZone, type TableShapeValue } from '../api/floors';
import { fetchOpenRegister } from '../api/registers';
import { createTable, deleteTable, patchTable } from '../api/tables';
import { createSuggestion } from '../api/suggestions';
import { ApiError } from '../api/client';
import { TableNode } from '../components/TableNode';
import { Spinner } from '../components/Spinner';
import { confirmDialog } from '../components/ConfirmDialog';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { formatMoney } from '../utils/format';

const ALL_ZONES = '__all__';

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'var(--bg)',
  },
  head: {
    padding: '20px 28px 14px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  titleBlock: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  sub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    fontSize: 12,
    color: 'var(--text2)',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  toolbar: { display: 'flex', alignItems: 'center', gap: 10 },
  zoneTabs: {
    display: 'flex',
    gap: 6,
    padding: '14px 28px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
  },
  body: {
    flex: 1,
    minHeight: 0,
    padding: '24px 28px 0',
    overflow: 'hidden',
  },
  canvas: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    overflow: 'auto',
    backgroundImage:
      'linear-gradient(rgba(168,152,136,0.08) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(168,152,136,0.08) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
    boxShadow: 'var(--shadow-sm)',
  },
  // Inner sized container so dragging tables past the visible viewport scrolls.
  canvasInner: {
    position: 'relative',
    minWidth: '100%',
    minHeight: '100%',
  },
  zoneSeparator: {
    position: 'absolute',
    color: 'var(--text3)',
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    fontWeight: 600,
    background: 'var(--bg2)',
    padding: '0 8px',
  },
  emptyCanvas: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: 'var(--text3)',
    fontSize: 13,
  },
  loadingWrap: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text2)',
    flexDirection: 'column',
    gap: 12,
    background: 'var(--bg2)',
  },
  errorWrap: {
    margin: 28,
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    borderRadius: 10,
    padding: '18px 22px',
    fontSize: 13,
  },
  // ─── Edit mode panel ─────────────────────────────────────────────
  editPanel: {
    flexShrink: 0,
    margin: '14px 28px 0',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    boxShadow: 'var(--shadow-sm)',
  },
  editLabel: {
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginRight: 4,
  },
  editBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
  },
  editBtnDanger: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid rgba(196,80,64,0.3)',
    background: 'transparent',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
  },
  editInput: {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    background: 'var(--bg)',
    color: 'var(--text1)',
    minWidth: 80,
    outline: 'none',
  },
  // ─── Popover for available-table tap ──────────────────────────────
  popover: {
    position: 'absolute',
    transform: 'translate(-50%, calc(-100% - 14px))',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    padding: '14px 16px',
    minWidth: 240,
    zIndex: 5,
  },
  popTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  popMeta: { fontSize: 12, color: 'var(--text2)', marginTop: 2 },
  popActions: { display: 'flex', gap: 8, marginTop: 12 },
  popPrimary: {
    flex: 1,
    minHeight: 40,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--text1)',
    fontFamily: 'inherit',
  },
  popGhost: {
    flex: 1,
    minHeight: 40,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    fontFamily: 'inherit',
  },
};

const swatchStyle = (color: string): React.CSSProperties => ({
  width: 14,
  height: 14,
  borderRadius: 4,
  background: color,
  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
});

const editToggleStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 40,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
});

const zoneTabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 16px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  color: active ? 'var(--text1)' : 'var(--text2)',
  background: active ? 'var(--bg2)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
  cursor: 'pointer',
  minHeight: 40,
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
});

interface DragState {
  tableId: string;
  zoneId: string;
  mode: 'drag' | 'resize';
  startX: number;
  startY: number;
  origin: { x: number; y: number; w: number; h: number };
  offset: { dx: number; dy: number; dw: number; dh: number };
}

const LEGEND = [
  { color: 'var(--green)', label: 'Available' },
  { color: 'var(--gold)', label: 'Occupied' },
  { color: 'var(--red)', label: 'Needs attention' },
  { color: '#3a566b', label: 'Reserved' },
];

// All zones laid out in one canvas: each zone gets its own y-offset so tables
// from different zones don't visually collide. Used when the user picks the
// "All Zones" tab. Grid step matches the canvas backgroundSize (40px).
const ALL_ZONES_GAP = 80;
function laneOffsetForZone(zones: FloorZone[], zoneId: string): number {
  let y = 0;
  for (const zone of zones) {
    if (zone.id === zoneId) return y;
    const zoneMaxY = zone.tables.reduce(
      (acc, t) => Math.max(acc, t.pos_y + t.height),
      120,
    );
    y += zoneMaxY + ALL_ZONES_GAP;
  }
  return y;
}

interface PopoverState {
  table: FloorTable;
  zoneId: string;
  // Pixel-space anchor inside the canvas inner container.
  x: number;
  y: number;
}

// Edit-mode capabilities:
// - WAITER: cannot enter edit mode at all (button hidden).
// - CASHIER / MANAGER: can move, resize, rotate, relabel, toggle shape on
//   *existing* tables. Cannot add or delete tables (deferred to admin
//   approval queue).
// - ADMIN: full control — add, delete, every edit operation.
const ROLES_LAYOUT_EDIT: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);
const ROLES_LAYOUT_CREATE: ReadonlySet<string> = new Set(['ADMIN']);

export function FloorPlan() {
  const queryClient = useQueryClient();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canEditLayout = ROLES_LAYOUT_EDIT.has(role);
  const canAddRemoveTables = ROLES_LAYOUT_CREATE.has(role);
  const openOrderDetail = useUi((s) => s.openOrderDetail);
  const [zoneId, setZoneId] = useState<string>(ALL_ZONES);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [openOrderError, setOpenOrderError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Find the cashier's currently-open shift. Required to create new orders —
  // the backend rejects POST /orders without a register_id. We fetch lazily so
  // a cashier who's just lurking on the floor doesn't pay for the round-trip.
  const registerQuery = useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => (userId ? fetchOpenRegister(userId) : Promise.resolve(null)),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const createOrderMutation = useMutation({
    mutationFn: ({ tableId }: { tableId: string }) => {
      const reg = registerQuery.data;
      if (!reg) {
        return Promise.reject(
          new ApiError(
            'No open shift — tap the shift pill in the top bar to open one.',
            409,
          ),
        );
      }
      return createOrder({
        register_id: reg.id,
        order_type: 'DINE_IN',
        table_id: tableId,
      });
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setPopover(null);
      openOrderDetail(order.id);
    },
    onError: (err) => {
      setOpenOrderError(err instanceof ApiError ? err.message : 'Could not open order');
    },
  });

  const { data: zones, isLoading, error } = useQuery({
    queryKey: ['floors'],
    queryFn: fetchFloors,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  // Active orders give us the per-table needs_attention flag (the floors
  // payload only knows about the *count* of open orders, not their state).
  const { data: activeOrders } = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: fetchActiveOrders,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const attentionByTable = useMemo(() => {
    const set = new Set<string>();
    (activeOrders ?? []).forEach((o: ActiveOrder) => {
      if (o.needs_attention && o.table_id) set.add(o.table_id);
    });
    return set;
  }, [activeOrders]);

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchTable>[1] }) =>
      patchTable(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });

  const createMutation = useMutation({
    mutationFn: createTable,
    onSuccess: (created) => {
      setSelectedId(created.id);
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTable,
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });

  // Cashier path — instead of creating a table directly, post a suggestion.
  // The list invalidation on success isn't necessary (the floor doesn't
  // change), but we surface a friendly status in the toolbar so the cashier
  // knows the request landed.
  const [suggestStatus, setSuggestStatus] = useState<string | null>(null);
  const suggestCreateMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createTable>[0]) =>
      createSuggestion({
        type: 'TABLE_CREATE',
        payload: payload as unknown as Record<string, unknown>,
      }),
    onSuccess: () => setSuggestStatus('Submitted to admin for approval'),
    onError: () => setSuggestStatus(null),
  });

  // Zone tabs derived from server response.
  const zoneTabs = useMemo(() => {
    if (!zones) return [];
    return [
      { id: ALL_ZONES, name: 'All Zones', count: zones.reduce((a, z) => a + z.tables.length, 0) },
      ...zones.map((z) => ({ id: z.id, name: z.name, count: z.tables.length })),
    ];
  }, [zones]);

  // Tables to render for the current tab (with synthetic y-offset for All).
  interface RenderEntry {
    table: FloorTable;
    zoneId: string;
    yOffset: number;
  }

  const renderTables: RenderEntry[] = useMemo(() => {
    if (!zones) return [];
    if (zoneId === ALL_ZONES) {
      return zones.flatMap((zone) => {
        const yOffset = laneOffsetForZone(zones, zone.id);
        return zone.tables.map((t) => ({ table: t, zoneId: zone.id, yOffset }));
      });
    }
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return [];
    return zone.tables.map((t) => ({ table: t, zoneId, yOffset: 0 }));
  }, [zones, zoneId]);

  // Bounds of the canvas based on tables + a margin so resize handles don't get
  // clipped at the right/bottom edges.
  const canvasBounds = useMemo(() => {
    let maxX = 800;
    let maxY = 600;
    for (const { table, yOffset } of renderTables) {
      maxX = Math.max(maxX, table.pos_x + table.width + 80);
      maxY = Math.max(maxY, table.pos_y + yOffset + table.height + 80);
    }
    return { width: maxX, height: maxY };
  }, [renderTables]);

  const selectedTable = useMemo(() => {
    if (!selectedId) return null;
    return renderTables.find((r) => r.table.id === selectedId) ?? null;
  }, [renderTables, selectedId]);

  // Pointer-driven drag/resize. We track movement on the window so the user
  // can be loose with the cursor — drops outside the canvas snap back to the
  // last valid position.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === 'drag') {
          return { ...prev, offset: { dx, dy, dw: 0, dh: 0 } };
        }
        return { ...prev, offset: { dx: 0, dy: 0, dw: dx, dh: dy } };
      });
    };

    const onUp = () => {
      setDrag((prev) => {
        if (!prev) return null;
        const moved =
          prev.offset.dx !== 0 ||
          prev.offset.dy !== 0 ||
          prev.offset.dw !== 0 ||
          prev.offset.dh !== 0;
        if (!moved) return null;
        const body =
          prev.mode === 'drag'
            ? {
                pos_x: Math.max(0, Math.round(prev.origin.x + prev.offset.dx)),
                pos_y: Math.max(0, Math.round(prev.origin.y + prev.offset.dy)),
              }
            : {
                width: Math.max(48, Math.round(prev.origin.w + prev.offset.dw)),
                height: Math.max(48, Math.round(prev.origin.h + prev.offset.dh)),
              };
        patchMutation.mutate({ id: prev.tableId, body });
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, patchMutation]);

  function startDrag(
    table: FloorTable,
    rZoneId: string,
    mode: 'drag' | 'resize',
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    if (!editing) return;
    e.preventDefault();
    setSelectedId(table.id);
    setDrag({
      tableId: table.id,
      zoneId: rZoneId,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: table.pos_x, y: table.pos_y, w: table.width, h: table.height },
      offset: { dx: 0, dy: 0, dw: 0, dh: 0 },
    });
  }

  function handleTableTap(entry: RenderEntry) {
    const t = entry.table;
    if (editing) {
      setSelectedId(t.id);
      return;
    }
    if (t.current_order) {
      openOrderDetail(t.current_order.id);
      return;
    }
    // Tap-to-open: skip the confirmation popover entirely and start a ticket.
    // Reverting wrong-table presses is cheap (cancel the empty order); the
    // friction cost of confirming every press is paid every shift.
    if (createOrderMutation.isPending) return;
    createOrderMutation.mutate({ tableId: t.id });
  }

  function toggleShape() {
    if (!selectedTable) return;
    const next: TableShapeValue =
      selectedTable.table.shape === 'TABLE_RECT' ? 'TABLE_CIRCLE' : 'TABLE_RECT';
    patchMutation.mutate({ id: selectedTable.table.id, body: { shape: next } });
  }

  function rotateSelected(delta: number) {
    if (!selectedTable) return;
    const next = (selectedTable.table.rotation + delta + 360) % 360;
    patchMutation.mutate({ id: selectedTable.table.id, body: { rotation: next } });
  }

  function relabelSelected() {
    if (!selectedTable) return;
    const initial = selectedTable.table.label ?? '';
    const next = window.prompt('Custom label (leave blank to use number)', initial);
    if (next === null) return;
    const cleaned = next.trim().slice(0, 40);
    patchMutation.mutate({
      id: selectedTable.table.id,
      body: { label: cleaned ? cleaned : null },
    });
  }

  async function deleteSelected() {
    if (!selectedTable) return;
    const label = selectedTable.table.label || `Table ${selectedTable.table.number}`;
    const ok = await confirmDialog({
      title: `Delete ${label}?`,
      message: 'The table will be removed from the floor plan. Active orders on this table must be settled first.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) deleteMutation.mutate(selectedTable.table.id);
  }

  function buildNewTableBody() {
    if (!zones || zones.length === 0) return null;
    const targetZone = zoneId === ALL_ZONES ? zones[0].id : zoneId;
    const targetZoneObj = zones.find((z) => z.id === targetZone);
    if (!targetZoneObj) return null;
    const usedNumbers = new Set(targetZoneObj.tables.map((t) => t.number));
    let number = 1;
    while (usedNumbers.has(number)) number++;
    return {
      zone_id: targetZone,
      number,
      pos_x: 60,
      pos_y: 60,
      width: 120,
      height: 120,
      shape: 'TABLE_RECT' as TableShapeValue,
    };
  }

  function addTable() {
    const body = buildNewTableBody();
    if (!body) {
      window.alert('Create a zone first in the admin panel.');
      return;
    }
    createMutation.mutate(body);
  }

  // Cashier counterpart to `addTable` — instead of executing, post a
  // suggestion. Admin sees it in the Suggested Changes tab.
  function suggestAddTable() {
    const body = buildNewTableBody();
    if (!body) {
      window.alert('Create a zone first in the admin panel.');
      return;
    }
    setSuggestStatus(null);
    suggestCreateMutation.mutate(body);
  }

  // Close the popover whenever the user changes tab / toggles edit / clicks
  // on the empty canvas.
  useEffect(() => {
    setPopover(null);
  }, [zoneId, editing]);

  const zoneCount = zoneTabs.length - 1;
  const totalTables = zones?.reduce((a, z) => a + z.tables.length, 0) ?? 0;
  const totalOpen = zones?.reduce((a, z) =>
    a + z.tables.reduce((b, t) => b + t.open_order_count, 0), 0) ?? 0;

  return (
    <div style={styles.root}>
      <header style={styles.head}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>Floor Plan</h1>
          <div style={styles.sub}>
            {zoneCount} zone{zoneCount === 1 ? '' : 's'} · {totalTables} tables · {totalOpen} active order
            {totalOpen === 1 ? '' : 's'}
          </div>
        </div>
        <div style={styles.legend}>
          {LEGEND.map((l) => (
            <span key={l.label} style={styles.legendItem}>
              <span style={swatchStyle(l.color)} />
              {l.label}
            </span>
          ))}
        </div>
        <div style={styles.toolbar}>
          {canEditLayout && (
            <button
              type="button"
              style={editToggleStyle(editing)}
              onClick={() => {
                setEditing((v) => !v);
                setSelectedId(null);
              }}
            >
              {editing ? '✓ Done editing' : '✎ Edit Layout'}
            </button>
          )}
        </div>
      </header>

      <div style={styles.zoneTabs}>
        {zoneTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            style={zoneTabStyle(zoneId === tab.id)}
            onClick={() => setZoneId(tab.id)}
          >
            {tab.name}
            <span style={{ marginLeft: 8, color: 'var(--text3)', fontSize: 11 }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {editing && (
        <div style={styles.editPanel}>
          <span style={styles.editLabel}>Selected</span>
          {selectedTable ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {selectedTable.table.label || `Table ${selectedTable.table.number}`}
              </span>
              <button type="button" style={styles.editBtn} onClick={toggleShape}>
                {selectedTable.table.shape === 'TABLE_RECT' ? '◯ Circle' : '▭ Rectangle'}
              </button>
              <button type="button" style={styles.editBtn} onClick={relabelSelected}>
                ✎ Label
              </button>
              <button type="button" style={styles.editBtn} onClick={() => rotateSelected(-15)}>
                ↺ -15°
              </button>
              <button type="button" style={styles.editBtn} onClick={() => rotateSelected(15)}>
                ↻ +15°
              </button>
              {canAddRemoveTables && (
                <button type="button" style={styles.editBtnDanger} onClick={deleteSelected}>
                  ✕ Delete
                </button>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              Tap a table to select. Drag to move, drag the corner handle to resize.
            </span>
          )}
          <span style={{ flex: 1 }} />
          {canAddRemoveTables ? (
            <button type="button" style={styles.editBtn} onClick={addTable}>
              + Add table
            </button>
          ) : canEditLayout ? (
            <button
              type="button"
              style={styles.editBtn}
              onClick={suggestAddTable}
              disabled={suggestCreateMutation.isPending}
            >
              {suggestCreateMutation.isPending ? 'Submitting…' : '＋ Suggest table'}
            </button>
          ) : null}
          {suggestStatus && (
            <span style={{ color: 'var(--green)', fontSize: 12 }}>{suggestStatus}</span>
          )}
          {suggestCreateMutation.error && (
            <span style={{ color: 'var(--red)', fontSize: 12 }}>
              {suggestCreateMutation.error instanceof ApiError
                ? suggestCreateMutation.error.message
                : 'Suggestion failed'}
            </span>
          )}
          {patchMutation.isPending && <Spinner size={14} />}
          {(patchMutation.error || createMutation.error || deleteMutation.error) && (
            <span style={{ color: 'var(--red)', fontSize: 12 }}>
              {[patchMutation.error, createMutation.error, deleteMutation.error]
                .find((e) => e instanceof ApiError)
                ?.message ?? 'Save failed'}
            </span>
          )}
        </div>
      )}

      <div style={styles.body}>
        <div style={styles.canvas} ref={canvasRef}>
          {isLoading && (
            <div style={styles.loadingWrap}>
              <Spinner size={26} />
              <div>Loading floor…</div>
            </div>
          )}
          {error && (
            <div style={styles.errorWrap}>
              {error instanceof ApiError ? error.message : 'Failed to load floor'}
            </div>
          )}
          {!isLoading && !error && renderTables.length === 0 && (
            <div style={styles.emptyCanvas}>
              {editing
                ? 'No tables yet. Tap "+ Add table" to start your floor plan.'
                : 'No tables in this zone.'}
            </div>
          )}

          <div
            style={{
              ...styles.canvasInner,
              width: canvasBounds.width,
              height: canvasBounds.height,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedId(null);
                setPopover(null);
              }
            }}
          >
            {/* Zone separators visible only when "All Zones" is selected. */}
            {zoneId === ALL_ZONES &&
              zones?.map((zone) => {
                const offsetY = laneOffsetForZone(zones, zone.id);
                return (
                  <div
                    key={zone.id}
                    style={{
                      ...styles.zoneSeparator,
                      top: offsetY - 18,
                      left: 18,
                    }}
                  >
                    {zone.name}
                  </div>
                );
              })}

            {renderTables.map(({ table, zoneId: zid, yOffset }) => {
              const adjustedTable: FloorTable = {
                ...table,
                pos_y: table.pos_y + yOffset,
              };
              const isDragging = drag?.tableId === table.id;
              return (
                <TableNode
                  key={table.id}
                  table={adjustedTable}
                  editing={editing}
                  selected={selectedId === table.id}
                  attention={attentionByTable.has(table.id)}
                  offset={isDragging ? drag.offset : undefined}
                  onPointerDown={(e, mode) => startDrag(adjustedTable, zid, mode, e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTableTap({ table: adjustedTable, zoneId: zid, yOffset });
                  }}
                />
              );
            })}

            {popover && (
              <Popover
                anchorX={popover.x}
                anchorY={popover.y}
                table={popover.table}
                busy={createOrderMutation.isPending}
                error={openOrderError}
                onCancel={() => {
                  setPopover(null);
                  setOpenOrderError(null);
                }}
                onOpen={() => {
                  setOpenOrderError(null);
                  createOrderMutation.mutate({ tableId: popover.table.id });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PopoverProps {
  anchorX: number;
  anchorY: number;
  table: FloorTable;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onOpen: () => void;
}

function Popover({ anchorX, anchorY, table, busy, error, onCancel, onOpen }: PopoverProps) {
  return (
    <div
      style={{
        ...styles.popover,
        left: anchorX,
        top: anchorY,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={styles.popTitle}>
        {table.label || `Table ${table.number}`}
      </h3>
      <div style={styles.popMeta}>
        Seats {table.capacity} · {table.status === 'AVAILABLE' ? 'Available' : table.status}
      </div>
      {table.current_order && (
        <div style={{ ...styles.popMeta, marginTop: 8, color: 'var(--text1)' }}>
          Open order #{table.current_order.order_number} · {formatMoney(table.current_order.total)}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'rgba(196,80,64,0.08)',
            color: 'var(--red)',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      <div style={styles.popActions}>
        <button type="button" style={styles.popGhost} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" style={styles.popPrimary} onClick={onOpen} disabled={busy}>
          {busy ? 'Opening…' : 'Open Order'}
        </button>
      </div>
    </div>
  );
}
