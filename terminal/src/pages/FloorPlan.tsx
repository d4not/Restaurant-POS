import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrder, fetchActiveOrders, type ActiveOrder } from '../api/orders';
import {
  fetchFloors,
  type DecorTypeValue,
  type FloorDecor,
  type FloorTable,
  type FloorZone,
  type TableShapeValue,
} from '../api/floors';
import { fetchCurrentRegister } from '../api/registers';
import { createTable, deleteTable, patchTable, patchTableStatus } from '../api/tables';
import { createZone, deleteZone, patchZone } from '../api/zones';
import {
  createDecor,
  deleteDecor,
  patchDecor,
  type CreateFloorDecorInput,
} from '../api/floor-decor';
import { createSuggestion } from '../api/suggestions';
import { ApiError } from '../api/client';
import { TableNode } from '../components/TableNode';
import { TakeoutZoneView } from '../components/TakeoutZoneView';
import { Spinner } from '../components/Spinner';
import { confirmDialog } from '../components/ConfirmDialog';
import {
  ALL_ZONES,
  FloorCanvas,
  type CanvasHandle,
} from '../components/floor-plan/Canvas';
import { ZoneContainer } from '../components/floor-plan/ZoneContainer';
import { BarCounter } from '../components/floor-plan/BarCounter';
import { DecorPlant } from '../components/floor-plan/DecorPlant';
import { EditBanner } from '../components/floor-plan/EditBanner';
import {
  FloatingToolbar,
  type ToolbarAction,
} from '../components/floor-plan/FloatingToolbar';
import {
  Inspector,
  type InspectorSelection,
} from '../components/floor-plan/Inspector';
import { AddMenu, type AddKind } from '../components/floor-plan/AddMenu';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useTranslation } from '../i18n';

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'var(--bg)',
  },
  zoneBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  zoneTabs: {
    display: 'flex',
    gap: 4,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
  },
  zoneActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minHeight: 0,
    padding: '14px 20px 20px',
    overflow: 'hidden',
    position: 'relative',
  },
};

const editToggleStyle = (active: boolean): CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 40,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

const addButtonStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 40,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const zoneTabStyle = (active: boolean): CSSProperties => ({
  padding: '9px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: active ? 'var(--text1)' : 'var(--text2)',
  background: active ? 'var(--bg2)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
  cursor: 'pointer',
  minHeight: 40,
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
});

const zoneCountStyle = (count: number, active: boolean): CSSProperties => ({
  marginLeft: 8,
  padding: count > 0 ? '1px 7px' : '0',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  minWidth: count > 0 ? 18 : 'auto',
  textAlign: 'center',
  background:
    count > 0
      ? active
        ? 'var(--gold)'
        : 'rgba(201,164,92,0.16)'
      : 'transparent',
  color:
    count > 0 ? (active ? '#2c2420' : 'var(--gold)') : 'var(--text3)',
});

// Edit-mode capabilities:
// - WAITER: cannot enter edit mode at all (button hidden).
// - CASHIER / MANAGER: can move/resize/rotate/relabel/toggle-shape on existing
//   tables. Cannot add or delete tables (deferred to admin queue) and cannot
//   touch zones or decor (admin-only).
// - ADMIN: full control on tables, zones, and decor.
const ROLES_TABLE_LAYOUT_EDIT: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);
const ROLES_TABLE_CREATE: ReadonlySet<string> = new Set(['ADMIN']);
const ROLES_ZONE_DECOR_EDIT: ReadonlySet<string> = new Set(['ADMIN']);

type SelectionKind = 'table' | 'zone' | 'decor';

interface Selection {
  kind: SelectionKind;
  id: string;
}

// Clipboard payload for Ctrl+C / Ctrl+V. Only the shape/type and size are
// preserved — name, number, label, position, rotation are NOT copied; the
// pasted element gets fresh identifiers and lands at an offset from the
// source.
type ClipboardItem =
  | { kind: 'table'; shape: TableShapeValue; width: number; height: number }
  | { kind: 'decor'; type: DecorTypeValue; width: number; height: number }
  | { kind: 'zone'; width: number; height: number };

interface DragState {
  kind: SelectionKind;
  id: string;
  // The DOM rect we use as the origin for delta math. Caller only sets
  // origin once on pointer-down so live deltas are deterministic.
  mode: 'drag' | 'resize';
  startX: number;
  startY: number;
  origin: { x: number; y: number; w: number; h: number };
  // Effective scale factor at the moment the drag started (canvasScale ×
  // zoneScale where applicable). Pointer deltas are divided by this to
  // translate screen pixels to canvas pixels.
  effectiveScale: number;
  offset: { dx: number; dy: number; dw: number; dh: number };
}

export function FloorPlan() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canEditTableLayout = ROLES_TABLE_LAYOUT_EDIT.has(role);
  const canCreateTable = ROLES_TABLE_CREATE.has(role);
  const canEditZoneDecor = ROLES_ZONE_DECOR_EDIT.has(role);
  const openOrderDetail = useUi((s) => s.openOrderDetail);

  const [zoneId, setZoneId] = useState<string>(ALL_ZONES);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openOrderError, setOpenOrderError] = useState<string | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Clipboard for Ctrl+C / Ctrl+V — only carries shape/size; identifiers
  // (table number, zone name, decor label) are auto-assigned on paste.
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);

  const canvasRef = useRef<CanvasHandle | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  // Keyboard nudges accumulate locally and commit to the server after a
  // short debounce so holding an arrow key doesn't fire one PATCH per frame.
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgePendingRef = useRef<
    | { id: string; kind: SelectionKind; pos_x: number; pos_y: number }
    | null
  >(null);

  // Find the singleton open shift (any role's register works). The backend
  // rejects POST /orders without a register_id; App.tsx already gates the UI
  // on this query so it should resolve from cache here.
  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: !!userId,
    staleTime: 15_000,
  });

  const { data: zones, isLoading, error } = useQuery({
    queryKey: ['floors'],
    queryFn: fetchFloors,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  // Active orders give us per-table needs_attention (the floors payload only
  // knows the *count* of open orders, not their state).
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

  // ─── Mutations ───────────────────────────────────────────────────────────
  const createOrderMutation = useMutation({
    mutationFn: ({ tableId }: { tableId: string }) => {
      const reg = registerQuery.data;
      if (!reg) {
        return Promise.reject(
          new ApiError('No open shift — tap the shift pill in the top bar to open one.', 409),
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
      openOrderDetail(order.id);
    },
    onError: (err) => {
      setOpenOrderError(err instanceof ApiError ? err.message : t('error.somethingWrong'));
    },
  });

  // Drag mutations all use the same optimistic-update pattern: snapshot the
  // floors cache, write the projected new geometry, roll back on error, then
  // refetch on settle. Without this, the brief gap between pointer-up and the
  // server's response renders the element back at its old coordinates — what
  // the user perceives as a "snap-back".
  function optimisticFloorsPatch(
    targetKind: 'table' | 'zone' | 'decor',
    id: string,
    body: object,
  ) {
    const patch = body as Record<string, unknown>;
    const previous = queryClient.getQueryData<FloorZone[]>(['floors']);
    queryClient.setQueryData<FloorZone[] | undefined>(['floors'], (old) => {
      if (!old) return old;
      return old.map((z) => {
        if (targetKind === 'zone' && z.id === id) {
          return { ...z, ...patch } as FloorZone;
        }
        if (targetKind === 'table') {
          const idx = z.tables.findIndex((t) => t.id === id);
          if (idx === -1) return z;
          const tables = z.tables.slice();
          tables[idx] = { ...tables[idx], ...patch } as FloorTable;
          return { ...z, tables };
        }
        if (targetKind === 'decor') {
          const idx = z.decor.findIndex((d) => d.id === id);
          if (idx === -1) return z;
          const decor = z.decor.slice();
          decor[idx] = { ...decor[idx], ...patch } as FloorDecor;
          return { ...z, decor };
        }
        return z;
      });
    });
    return previous;
  }

  const tablePatchM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchTable>[1] }) =>
      patchTable(id, body),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: ['floors'] });
      const previous = optimisticFloorsPatch('table', id, body);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['floors'], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });
  const tableCreateM = useMutation({
    mutationFn: createTable,
    onSuccess: (created) => {
      setSelection({ kind: 'table', id: created.id });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });
  const tableDeleteM = useMutation({
    mutationFn: deleteTable,
    onSuccess: () => {
      setSelection(null);
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });
  const tableStatusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Parameters<typeof patchTableStatus>[1] }) =>
      patchTableStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });

  const zonePatchM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchZone>[1] }) =>
      patchZone(id, body),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: ['floors'] });
      const previous = optimisticFloorsPatch('zone', id, body);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['floors'], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });
  const zoneCreateM = useMutation({
    mutationFn: createZone,
    onSuccess: (created) => {
      setSelection({ kind: 'zone', id: created.id });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });
  const zoneDeleteM = useMutation({
    mutationFn: deleteZone,
    onSuccess: () => {
      setSelection(null);
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });

  const decorPatchM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchDecor>[1] }) =>
      patchDecor(id, body),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: ['floors'] });
      const previous = optimisticFloorsPatch('decor', id, body);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['floors'], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });
  const decorCreateM = useMutation({
    mutationFn: (input: CreateFloorDecorInput) => createDecor(input),
    onSuccess: (created) => {
      setSelection({ kind: 'decor', id: created.id });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });
  const decorDeleteM = useMutation({
    mutationFn: deleteDecor,
    onSuccess: () => {
      setSelection(null);
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
  });

  // ─── Cashier suggest-table (unchanged from prior implementation) ─────────
  const [suggestStatus, setSuggestStatus] = useState<string | null>(null);
  const suggestCreateM = useMutation({
    mutationFn: (payload: Parameters<typeof createTable>[0]) =>
      createSuggestion({
        type: 'TABLE_CREATE',
        payload: payload as unknown as Record<string, unknown>,
      }),
    onSuccess: () => setSuggestStatus('Submitted to admin for approval'),
    onError: () => setSuggestStatus(null),
  });

  // ─── Derived data ────────────────────────────────────────────────────────
  const selectedZone = useMemo(() => {
    if (!zones || zoneId === ALL_ZONES) return null;
    return zones.find((z) => z.id === zoneId) ?? null;
  }, [zones, zoneId]);
  const isTakeoutZoneSelected = selectedZone?.kind === 'TAKEOUT';

  const takeoutOrders = useMemo(
    () => (activeOrders ?? []).filter((o: ActiveOrder) => o.order_type === 'TAKEOUT'),
    [activeOrders],
  );

  // Tabs: dine-in zones + takeout (if seeded) + the synthetic "All Zones".
  const zoneTabs = useMemo(() => {
    if (!zones) return [];
    const dineInZones = zones.filter((z) => z.kind !== 'TAKEOUT');
    const takeoutZone = zones.find((z) => z.kind === 'TAKEOUT');
    const activeIn = (z: FloorZone) =>
      z.tables.reduce((a, t) => a + t.open_order_count, 0);
    const tabs = [
      {
        id: ALL_ZONES,
        name: t('floor.allZones'),
        count: dineInZones.reduce((a, z) => a + activeIn(z), 0),
        kind: 'DINE_IN' as const,
      },
      ...dineInZones.map((z) => ({
        id: z.id,
        name: z.name,
        count: activeIn(z),
        kind: z.kind,
      })),
    ];
    if (takeoutZone) {
      tabs.push({
        id: takeoutZone.id,
        name: takeoutZone.name,
        count: takeoutOrders.length,
        kind: takeoutZone.kind,
      });
    }
    return tabs;
  }, [zones, takeoutOrders]);

  // Effective zone size — the visible footprint of each zone. We grow the
  // stored width/height to encompass any tables/decor that extend past it
  // (legacy seeded layouts assumed a wider canvas, so this prevents the
  // dashed-border container from clipping its own contents). The user can
  // still drag/resize zones freely; this only enlarges past the persisted
  // size, never shrinks below it.
  const effectiveZones = useMemo(() => {
    if (!zones) return [] as FloorZone[];
    return zones.map((z) => {
      if (z.kind === 'TAKEOUT') return z;
      let maxX = z.width;
      let maxY = z.height;
      for (const t of z.tables) {
        maxX = Math.max(maxX, t.pos_x + t.width + 24);
        maxY = Math.max(maxY, t.pos_y + t.height + 40);
      }
      for (const d of z.decor) {
        maxX = Math.max(maxX, d.pos_x + d.width + 24);
        maxY = Math.max(maxY, d.pos_y + d.height + 24);
      }
      return { ...z, width: maxX, height: maxY };
    });
  }, [zones]);

  // Inner-canvas size: bounding box of all (effective) zones plus a margin so
  // resize handles drawn outside the zone box aren't clipped by the wrap.
  const canvasBounds = useMemo(() => {
    let maxX = 1200;
    let maxY = 800;
    for (const z of effectiveZones) {
      if (z.kind === 'TAKEOUT') continue;
      maxX = Math.max(maxX, z.pos_x + z.width + 200);
      maxY = Math.max(maxY, z.pos_y + z.height + 200);
    }
    return { width: maxX, height: maxY };
  }, [effectiveZones]);

  // Resolve the current selection to the underlying record + zone context.
  // Uses `effectiveZones` so the inspector and floating toolbar see the same
  // dimensions the canvas actually renders (matters when a zone has been
  // auto-grown to contain overflowing tables).
  const selectionRecord = useMemo<InspectorSelection | null>(() => {
    if (!selection || effectiveZones.length === 0) return null;
    if (selection.kind === 'zone') {
      const z = effectiveZones.find((zz) => zz.id === selection.id);
      return z ? { kind: 'zone', zone: z } : null;
    }
    if (selection.kind === 'table') {
      for (const z of effectiveZones) {
        const t = z.tables.find((tt) => tt.id === selection.id);
        if (t) return { kind: 'table', table: t, zoneName: z.name };
      }
      return null;
    }
    for (const z of effectiveZones) {
      const d = z.decor.find((dd) => dd.id === selection.id);
      if (d) return { kind: 'decor', decor: d };
    }
    return null;
  }, [selection, effectiveZones]);

  // ─── Drag/resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - drag.startX) / drag.effectiveScale;
      const dy = (e.clientY - drag.startY) / drag.effectiveScale;
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === 'drag') return { ...prev, offset: { dx, dy, dw: 0, dh: 0 } };
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
                width: Math.max(40, Math.round(prev.origin.w + prev.offset.dw)),
                height: Math.max(40, Math.round(prev.origin.h + prev.offset.dh)),
              };
        if (prev.kind === 'table') tablePatchM.mutate({ id: prev.id, body });
        else if (prev.kind === 'zone') zonePatchM.mutate({ id: prev.id, body });
        else decorPatchM.mutate({ id: prev.id, body });
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
  }, [drag, tablePatchM, zonePatchM, decorPatchM]);

  // The effective scale at the moment of pointer-down. For tables/decor inside
  // a focused zone, both canvas and zone scale apply; otherwise just canvas.
  function effectiveScaleFor(kind: SelectionKind, parentZoneId: string | null): number {
    const canvasScale = canvasRef.current?.getCanvasScale() ?? 1;
    if (kind === 'zone') return canvasScale;
    const zoneScale = parentZoneId ? canvasRef.current?.getZoneScale(parentZoneId) ?? 1 : 1;
    return canvasScale * zoneScale;
  }

  function startDrag(
    kind: SelectionKind,
    id: string,
    parentZoneId: string | null,
    mode: 'drag' | 'resize',
    e: React.PointerEvent<HTMLDivElement>,
    origin: { x: number; y: number; w: number; h: number },
  ) {
    if (!editing) return;
    if (kind === 'table' && !canEditTableLayout) return;
    if ((kind === 'zone' || kind === 'decor') && !canEditZoneDecor) return;
    e.preventDefault();
    e.stopPropagation();
    setSelection({ kind, id });
    setDrag({
      kind,
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin,
      effectiveScale: effectiveScaleFor(kind, parentZoneId),
      offset: { dx: 0, dy: 0, dw: 0, dh: 0 },
    });
  }

  // ─── Click handlers ──────────────────────────────────────────────────────
  function handleTableClick(table: FloorTable) {
    if (editing) {
      if (canEditTableLayout) setSelection({ kind: 'table', id: table.id });
      return;
    }
    if (table.current_order) {
      openOrderDetail(table.current_order.id);
      return;
    }
    // Reserved tables stay locked — the operator must clear the reservation
    // first via the inspector before opening a ticket.
    if (table.status === 'RESERVED') return;
    if (createOrderMutation.isPending) return;
    setOpenOrderError(null);
    createOrderMutation.mutate({ tableId: table.id });
  }

  function handleZoneClick(zone: FloorZone) {
    if (!editing) {
      // Tapping a zone in view mode focuses that zone in the canvas, matching
      // the wireframe's "click background to drill in" gesture.
      setZoneId(zone.id);
      return;
    }
    if (canEditZoneDecor) setSelection({ kind: 'zone', id: zone.id });
  }

  function handleDecorClick(decor: FloorDecor) {
    if (editing) {
      if (canEditZoneDecor) setSelection({ kind: 'decor', id: decor.id });
      return;
    }
    // View-mode shortcut: tapping a BAR_COUNTER jumps to the takeout/delivery
    // tab. The bar IS the takeout pickup point in this layout — letting the
    // operator hop straight from the floor canvas to the takeout list saves a
    // tab roundtrip during a busy shift.
    if (decor.type === 'BAR_COUNTER') {
      const takeoutZone = zones?.find((z) => z.kind === 'TAKEOUT');
      if (takeoutZone) setZoneId(takeoutZone.id);
    }
  }

  // ─── Add menu actions ───────────────────────────────────────────────────
  function handleAdd(kind: AddKind) {
    setAddMenuAnchor(null);
    if (!zones) return;
    const dine = zones.filter((z) => z.kind !== 'TAKEOUT');

    if (kind === 'zone') {
      if (!canEditZoneDecor) return;
      // Place the new zone to the right of the rightmost existing zone.
      const right = dine.reduce((acc, z) => Math.max(acc, z.pos_x + z.width), 0);
      zoneCreateM.mutate({
        name: 'New zone',
        pos_x: right + 30,
        pos_y: 30,
        width: 480,
        height: 320,
      });
      return;
    }

    // Tables/decor need a target zone. Resolution priority:
    //   1. The zone the user has currently selected (most explicit signal)
    //   2. The parent zone of a selected table/decor
    //   3. The focused zone tab
    //   4. First dine-in zone (fallback for "All Zones")
    const selectedZoneId = (() => {
      if (!selection) return null;
      if (selection.kind === 'zone') return selection.id;
      if (selection.kind === 'table') {
        return dine.find((z) => z.tables.some((t) => t.id === selection.id))?.id ?? null;
      }
      return dine.find((z) => z.decor.some((d) => d.id === selection.id))?.id ?? null;
    })();
    const targetZoneId =
      selectedZoneId ?? (zoneId !== ALL_ZONES ? zoneId : null);
    const targetZone = targetZoneId
      ? dine.find((z) => z.id === targetZoneId) ?? dine[0]
      : dine[0];
    if (!targetZone) {
      window.alert('Create a zone first.');
      return;
    }

    if (kind === 'table-rect' || kind === 'table-circle') {
      const used = new Set(targetZone.tables.map((t) => t.number));
      let n = 1;
      while (used.has(n)) n++;
      const body = {
        zone_id: targetZone.id,
        number: n,
        pos_x: 24,
        pos_y: 38,
        width: kind === 'table-circle' ? 92 : 100,
        height: kind === 'table-circle' ? 92 : 100,
        shape: kind === 'table-circle' ? ('TABLE_CIRCLE' as const) : ('TABLE_RECT' as const),
      };
      if (canCreateTable) {
        tableCreateM.mutate(body);
      } else if (canEditTableLayout) {
        setSuggestStatus(null);
        suggestCreateM.mutate(body);
      }
      return;
    }

    if (kind === 'bar-counter') {
      if (!canEditZoneDecor) return;
      decorCreateM.mutate({
        zone_id: targetZone.id,
        type: 'BAR_COUNTER',
        pos_x: 24,
        pos_y: 80,
        width: Math.min(targetZone.width - 48, 240),
        height: 60,
        label: 'Bar',
      });
      return;
    }

    if (kind === 'plant') {
      if (!canEditZoneDecor) return;
      decorCreateM.mutate({
        zone_id: targetZone.id,
        type: 'DECOR_PLANT',
        pos_x: 24,
        pos_y: 24,
        width: 28,
        height: 28,
      });
    }
  }

  // ─── Clipboard (Ctrl+C / Ctrl+V) ────────────────────────────────────────
  function copySelection() {
    if (!selectionRecord) return;
    if (selectionRecord.kind === 'table') {
      const t = selectionRecord.table;
      setClipboard({
        kind: 'table',
        shape: t.shape,
        width: t.width,
        height: t.height,
      });
    } else if (selectionRecord.kind === 'zone') {
      const z = selectionRecord.zone;
      setClipboard({ kind: 'zone', width: z.width, height: z.height });
    } else {
      const d = selectionRecord.decor;
      setClipboard({
        kind: 'decor',
        type: d.type,
        width: d.width,
        height: d.height,
      });
    }
  }

  function pasteFromClipboard() {
    if (!clipboard || !zones) return;
    const dine = zones.filter((z) => z.kind !== 'TAKEOUT');

    if (clipboard.kind === 'zone') {
      if (!canEditZoneDecor) return;
      // New zone goes to the right of the rightmost existing zone, mirroring
      // handleAdd('zone') so the layout stays predictable.
      const right = dine.reduce((acc, z) => Math.max(acc, z.pos_x + z.width), 0);
      zoneCreateM.mutate({
        name: 'New zone',
        pos_x: right + 30,
        pos_y: 30,
        width: clipboard.width,
        height: clipboard.height,
      });
      return;
    }

    // Tables/decor land in: selected zone → parent zone of selected element →
    // focused tab zone → first dine-in. Same priority as handleAdd, so
    // keyboard paste and the Add menu agree on the target.
    const selectedZoneId = (() => {
      if (!selection) return null;
      if (selection.kind === 'zone') return selection.id;
      if (selection.kind === 'table') {
        return dine.find((z) => z.tables.some((t) => t.id === selection.id))?.id ?? null;
      }
      return dine.find((z) => z.decor.some((d) => d.id === selection.id))?.id ?? null;
    })();
    const targetZoneId =
      selectedZoneId ?? (zoneId !== ALL_ZONES ? zoneId : null);
    const targetZone = targetZoneId
      ? dine.find((z) => z.id === targetZoneId) ?? dine[0]
      : dine[0];
    if (!targetZone) return;

    // Offset the paste from the source so the new element doesn't sit
    // exactly on top of it. Falls back to (24, 24) when no source position
    // is available (e.g., copy from one zone, paste into a different one).
    const baseX =
      selectionRecord && selectionRecord.kind !== 'zone'
        ? (selectionRecord.kind === 'table'
            ? selectionRecord.table.pos_x
            : selectionRecord.decor.pos_x) + 24
        : 24;
    const baseY =
      selectionRecord && selectionRecord.kind !== 'zone'
        ? (selectionRecord.kind === 'table'
            ? selectionRecord.table.pos_y
            : selectionRecord.decor.pos_y) + 24
        : 24;

    if (clipboard.kind === 'table') {
      const used = new Set(targetZone.tables.map((t) => t.number));
      let n = 1;
      while (used.has(n)) n++;
      const body = {
        zone_id: targetZone.id,
        number: n,
        pos_x: baseX,
        pos_y: baseY,
        width: clipboard.width,
        height: clipboard.height,
        shape: clipboard.shape,
      };
      if (canCreateTable) tableCreateM.mutate(body);
      else if (canEditTableLayout) {
        setSuggestStatus(null);
        suggestCreateM.mutate(body);
      }
      return;
    }

    // Decor paste — admin only.
    if (!canEditZoneDecor) return;
    decorCreateM.mutate({
      zone_id: targetZone.id,
      type: clipboard.type,
      pos_x: baseX,
      pos_y: baseY,
      width: clipboard.width,
      height: clipboard.height,
      label: clipboard.type === 'BAR_COUNTER' ? 'Bar' : null,
    });
  }

  // ─── Delete via keyboard (uses the same confirm flow as the toolbar) ─────
  async function deleteSelectionViaKeyboard() {
    if (!selectionRecord) return;
    if (selectionRecord.kind === 'table') {
      if (!canCreateTable) return;
      const t = selectionRecord.table;
      const ok = await confirmDialog({
        title: `Delete ${t.label || `Table ${t.number}`}?`,
        message: 'Active orders on this table must be settled first.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) tableDeleteM.mutate(t.id);
      return;
    }
    if (selectionRecord.kind === 'zone') {
      if (!canEditZoneDecor) return;
      const z = selectionRecord.zone;
      const ok = await confirmDialog({
        title: `Delete zone "${z.name}"?`,
        message:
          "The zone's tables will be deactivated. Open orders block deletion.",
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) zoneDeleteM.mutate(z.id);
      return;
    }
    if (!canEditZoneDecor) return;
    const ok = await confirmDialog({
      title: 'Delete this decor?',
      message: 'It will be removed from the floor plan.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) decorDeleteM.mutate(selectionRecord.decor.id);
  }

  // ─── Arrow-key nudge with debounced server commit ───────────────────────
  function nudgeSelection(dx: number, dy: number) {
    if (!selectionRecord) return;
    // Permission gate matches drag: tables need table-edit; zones/decor need
    // zone-edit. Without this, a cashier could nudge a zone via keyboard.
    if (selectionRecord.kind === 'table' && !canEditTableLayout) return;
    if (selectionRecord.kind !== 'table' && !canEditZoneDecor) return;
    const id =
      selectionRecord.kind === 'table'
        ? selectionRecord.table.id
        : selectionRecord.kind === 'zone'
          ? selectionRecord.zone.id
          : selectionRecord.decor.id;
    const cur =
      selectionRecord.kind === 'table'
        ? selectionRecord.table
        : selectionRecord.kind === 'zone'
          ? selectionRecord.zone
          : selectionRecord.decor;
    const new_x = Math.max(0, cur.pos_x + dx);
    const new_y = Math.max(0, cur.pos_y + dy);
    // Optimistic write so the visual moves immediately; the debounce decides
    // when the server hears about it.
    optimisticFloorsPatch(selectionRecord.kind, id, {
      pos_x: new_x,
      pos_y: new_y,
    });
    nudgePendingRef.current = { id, kind: selectionRecord.kind, pos_x: new_x, pos_y: new_y };
    if (nudgeTimerRef.current !== null) {
      window.clearTimeout(nudgeTimerRef.current);
    }
    nudgeTimerRef.current = window.setTimeout(() => {
      const p = nudgePendingRef.current;
      nudgePendingRef.current = null;
      nudgeTimerRef.current = null;
      if (!p) return;
      const body = { pos_x: p.pos_x, pos_y: p.pos_y };
      if (p.kind === 'table') tablePatchM.mutate({ id: p.id, body });
      else if (p.kind === 'zone') zonePatchM.mutate({ id: p.id, body });
      else decorPatchM.mutate({ id: p.id, body });
    }, 220);
  }

  // ─── Global keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when the user is typing in an inspector input or
      // any other editable surface — otherwise pressing "v" inside a name
      // field would trigger paste.
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      const isMeta = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (isMeta && (k === 'c' || k === 'C')) {
        if (!selectionRecord) return;
        e.preventDefault();
        copySelection();
        return;
      }
      if (isMeta && (k === 'v' || k === 'V')) {
        if (!clipboard) return;
        e.preventDefault();
        pasteFromClipboard();
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        if (!selectionRecord) return;
        e.preventDefault();
        void deleteSelectionViaKeyboard();
        return;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        if (!selectionRecord) return;
        e.preventDefault();
        // Bigger step when Shift is held — matches the "fine vs coarse"
        // pattern most editors use for keyboard-nudged elements.
        const step = e.shiftKey ? 16 : 4;
        if (k === 'ArrowUp') nudgeSelection(0, -step);
        if (k === 'ArrowDown') nudgeSelection(0, step);
        if (k === 'ArrowLeft') nudgeSelection(-step, 0);
        if (k === 'ArrowRight') nudgeSelection(step, 0);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectionRecord, clipboard, selection, zoneId, zones]);

  // ─── Toolbar actions ────────────────────────────────────────────────────
  function buildToolbarActions(): ToolbarAction[] {
    if (!selectionRecord) return [];
    if (selectionRecord.kind === 'table') {
      const t = selectionRecord.table;
      const actions: ToolbarAction[] = [
        {
          key: 'shape',
          icon: t.shape === 'TABLE_RECT' ? '◯' : '▭',
          label: t.shape === 'TABLE_RECT' ? 'Round' : 'Square',
          onClick: () =>
            tablePatchM.mutate({
              id: t.id,
              body: { shape: t.shape === 'TABLE_RECT' ? 'TABLE_CIRCLE' : 'TABLE_RECT' },
            }),
        },
        {
          key: 'rotL',
          icon: '↺',
          onClick: () =>
            tablePatchM.mutate({
              id: t.id,
              body: { rotation: (t.rotation - 15 + 360) % 360 },
            }),
        },
        {
          key: 'rotR',
          icon: '↻',
          onClick: () =>
            tablePatchM.mutate({
              id: t.id,
              body: { rotation: (t.rotation + 15) % 360 },
            }),
        },
      ];
      if (canCreateTable) {
        actions.push({
          key: 'del',
          icon: '🗑',
          danger: true,
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Delete ${t.label || `Table ${t.number}`}?`,
              message:
                'The table will be removed from the floor plan. Active orders on this table must be settled first.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (ok) tableDeleteM.mutate(t.id);
          },
        });
      }
      return actions;
    }
    if (selectionRecord.kind === 'zone') {
      const z = selectionRecord.zone;
      return [
        {
          key: 'del',
          icon: '🗑',
          danger: true,
          hidden: !canEditZoneDecor,
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Delete zone "${z.name}"?`,
              message:
                "The zone's tables will be deactivated. Open orders block deletion.",
              confirmLabel: 'Delete',
              danger: true,
            });
            if (ok) zoneDeleteM.mutate(z.id);
          },
        },
      ];
    }
    // Decor
    const d = selectionRecord.decor;
    return [
      {
        key: 'rotL',
        icon: '↺',
        onClick: () =>
          decorPatchM.mutate({
            id: d.id,
            body: { rotation: (d.rotation - 15 + 360) % 360 },
          }),
      },
      {
        key: 'rotR',
        icon: '↻',
        onClick: () =>
          decorPatchM.mutate({
            id: d.id,
            body: { rotation: (d.rotation + 15) % 360 },
          }),
      },
      {
        key: 'del',
        icon: '🗑',
        danger: true,
        hidden: !canEditZoneDecor,
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete this decor?',
            message: 'It will be removed from the floor plan.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) decorDeleteM.mutate(d.id);
        },
      },
    ];
  }

  // Anchor coords for the floating toolbar — pixel position above the
  // selection's bounding box, in canvas-inner space (so it tracks the canvas
  // transform/scale automatically when rendered as a sibling of the zones).
  const toolbarAnchor = useMemo(() => {
    if (!selectionRecord) return null;
    if (selectionRecord.kind === 'zone') {
      const z = selectionRecord.zone;
      return { x: z.pos_x + 12, y: z.pos_y - 38 };
    }
    if (selectionRecord.kind === 'table') {
      // Need to convert zone-relative table coords to canvas-absolute by
      // walking up to the parent zone.
      if (!zones) return null;
      const parent = zones.find((z) => z.tables.some((t) => t.id === selectionRecord.table.id));
      if (!parent) return null;
      const t = selectionRecord.table;
      return {
        x: parent.pos_x + t.pos_x + 4,
        y: parent.pos_y + t.pos_y - 38,
      };
    }
    if (selectionRecord.kind === 'decor') {
      if (!zones) return null;
      const parent = zones.find((z) => z.decor.some((d) => d.id === selectionRecord.decor.id));
      if (!parent) return null;
      const d = selectionRecord.decor;
      return {
        x: parent.pos_x + d.pos_x + 4,
        y: parent.pos_y + d.pos_y - 38,
      };
    }
    return null;
  }, [selectionRecord, zones]);

  // Close add menu on tab/edit toggle (matches the wireframe's behavior).
  useEffect(() => {
    setAddMenuAnchor(null);
  }, [zoneId, editing]);

  // Clear selection when leaving edit mode.
  useEffect(() => {
    if (!editing) setSelection(null);
  }, [editing]);

  return (
    <div style={styles.root}>
      <div style={styles.zoneBar}>
        <div style={styles.zoneTabs}>
          {zoneTabs.map((tab) => {
            const active = zoneId === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                style={zoneTabStyle(active)}
                onClick={() => setZoneId(tab.id)}
              >
                {tab.name}
                <span style={zoneCountStyle(tab.count, active)}>{tab.count}</span>
              </button>
            );
          })}
        </div>
        <div style={styles.zoneActions}>
          {(canEditTableLayout || canEditZoneDecor) && !isTakeoutZoneSelected && editing && (
            <button
              ref={addBtnRef}
              type="button"
              style={addButtonStyle}
              onClick={() => {
                if (addMenuAnchor) {
                  setAddMenuAnchor(null);
                  return;
                }
                const r = addBtnRef.current?.getBoundingClientRect();
                if (r) setAddMenuAnchor({ x: r.right - 200, y: r.bottom + 6 });
              }}
            >
              + Add
            </button>
          )}
          {canEditTableLayout && !isTakeoutZoneSelected && (
            <button
              type="button"
              style={editToggleStyle(editing)}
              onClick={() => {
                setEditing((v) => !v);
                setSelection(null);
              }}
            >
              {editing ? `✓ ${t('common.done')}` : `✎ ${t('common.edit')}`}
            </button>
          )}
        </div>
      </div>

      {isTakeoutZoneSelected && selectedZone ? (
        <TakeoutZoneView
          zoneName={selectedZone.name}
          takeoutOrders={takeoutOrders}
          register={registerQuery.data ?? null}
          onRefetchRegister={() => registerQuery.refetch()}
        />
      ) : (
        <div
          className="floor-canvas-body"
          style={{
            ...styles.body,
            // Reserve room for the Inspector drawer when it's open so the
            // canvas (and the bottom-right resize handle of any selected
            // zone/table) doesn't slip behind it. Inspector is 300px wide
            // with a 16px right inset; we add a 16px gap between the canvas
            // and the drawer for breathing room.
            paddingRight: editing && selectionRecord ? 332 : 20,
          }}
        >
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text2)' }}>
              <Spinner size={26} />
              <span>{t('common.loading')}…</span>
            </div>
          )}
          {error && (
            <div
              style={{
                background: 'rgba(196,80,64,0.08)',
                border: '1px solid rgba(196,80,64,0.25)',
                color: 'var(--red)',
                borderRadius: 10,
                padding: '18px 22px',
                fontSize: 13,
              }}
            >
              {error instanceof ApiError ? error.message : t('orders.failedLoad')}
            </div>
          )}
          {openOrderError && (
            <div
              style={{
                position: 'absolute',
                top: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 25,
                background: '#fff',
                border: '1px solid rgba(196,80,64,0.3)',
                color: 'var(--red)',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
              }}
            >
              {openOrderError}
              <button
                type="button"
                onClick={() => setOpenOrderError(null)}
                style={{
                  marginLeft: 12,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                ×
              </button>
            </div>
          )}
          {!isLoading && !error && zones && (
            <FloorCanvas
              ref={canvasRef}
              zones={effectiveZones}
              focusedZoneId={zoneId}
              canvasWidth={canvasBounds.width}
              canvasHeight={canvasBounds.height}
              editing={editing}
              renderZones={({ zoneTransforms, fadedZoneIds }) =>
                effectiveZones
                  .filter((z) => z.kind !== 'TAKEOUT')
                  .map((zone) => (
                    <ZoneContainer
                      key={zone.id}
                      id={zone.id}
                      name={zone.name}
                      pos_x={zone.pos_x}
                      pos_y={zone.pos_y}
                      width={zone.width}
                      height={zone.height}
                      transform={zoneTransforms.get(zone.id)}
                      faded={fadedZoneIds.has(zone.id)}
                      metaText={(() => {
                        const open = zone.tables.reduce(
                          (a, t) => a + t.open_order_count,
                          0,
                        );
                        return open > 0
                          ? `${open} active`
                          : `${zone.tables.length} ${
                              zone.tables.length === 1 ? 'table' : 'tables'
                            }`;
                      })()}
                      editing={editing}
                      selected={
                        selection?.kind === 'zone' && selection.id === zone.id
                      }
                      offset={
                        drag?.kind === 'zone' && drag.id === zone.id ? drag.offset : undefined
                      }
                      onPointerDown={(e, mode) =>
                        startDrag('zone', zone.id, null, mode, e, {
                          x: zone.pos_x,
                          y: zone.pos_y,
                          w: zone.width,
                          h: zone.height,
                        })
                      }
                      onClick={() => handleZoneClick(zone)}
                    >
                      {zone.tables.map((table) => {
                        const isDragging = drag?.kind === 'table' && drag.id === table.id;
                        return (
                          <TableNode
                            key={table.id}
                            table={table}
                            editing={editing && canEditTableLayout}
                            selected={
                              selection?.kind === 'table' && selection.id === table.id
                            }
                            attention={attentionByTable.has(table.id)}
                            offset={isDragging ? drag.offset : undefined}
                            onPointerDown={(e, mode) =>
                              startDrag('table', table.id, zone.id, mode, e, {
                                x: table.pos_x,
                                y: table.pos_y,
                                w: table.width,
                                h: table.height,
                              })
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTableClick(table);
                            }}
                          />
                        );
                      })}
                      {zone.decor.map((decor) => {
                        const isDragging = drag?.kind === 'decor' && drag.id === decor.id;
                        const common = {
                          decor,
                          editing: editing && canEditZoneDecor,
                          selected:
                            selection?.kind === 'decor' && selection.id === decor.id,
                          offset: isDragging ? drag.offset : undefined,
                          onPointerDown: (
                            e: React.PointerEvent<HTMLDivElement>,
                            mode: 'drag' | 'resize',
                          ) =>
                            startDrag('decor', decor.id, zone.id, mode, e, {
                              x: decor.pos_x,
                              y: decor.pos_y,
                              w: decor.width,
                              h: decor.height,
                            }),
                          onClick: (e: React.MouseEvent) => {
                            e.stopPropagation();
                            handleDecorClick(decor);
                          },
                        };
                        return decor.type === 'BAR_COUNTER' ? (
                          <BarCounter
                            key={decor.id}
                            {...common}
                            takeoutShortcut={Boolean(
                              zones?.some((z) => z.kind === 'TAKEOUT'),
                            )}
                          />
                        ) : (
                          <DecorPlant key={decor.id} {...common} />
                        );
                      })}
                    </ZoneContainer>
                  ))
              }
            >
              {editing && <EditBanner />}
              {editing && toolbarAnchor && selectionRecord && (
                <FloatingToolbar
                  anchorX={toolbarAnchor.x}
                  anchorY={toolbarAnchor.y}
                  title={toolbarTitle(selectionRecord)}
                  actions={buildToolbarActions()}
                />
              )}
            </FloorCanvas>
          )}

          {editing && selectionRecord && (
            <Inspector
              selection={selectionRecord}
              canDelete={
                selectionRecord.kind === 'table'
                  ? canCreateTable
                  : canEditZoneDecor
              }
              onSaveZone={(id, patch) => zonePatchM.mutate({ id, body: patch })}
              onSaveTable={(id, patch) => {
                // Status flip has a dedicated endpoint; everything else flows
                // through the layout PATCH. Split here so a single Save can
                // commit both at once if the user changed multiple things.
                const { status, ...rest } = patch;
                if (Object.keys(rest).length > 0) {
                  tablePatchM.mutate({ id, body: rest });
                }
                if (status) tableStatusM.mutate({ id, status });
              }}
              onSaveDecor={(id, patch) => decorPatchM.mutate({ id, body: patch })}
              onDeleteZone={async (id) => {
                const z = zones?.find((zz) => zz.id === id);
                if (!z) return;
                const ok = await confirmDialog({
                  title: `Delete zone "${z.name}"?`,
                  message:
                    "The zone's tables will be deactivated. Open orders block deletion.",
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) zoneDeleteM.mutate(id);
              }}
              onDeleteTable={async (id) => {
                const t = zones
                  ?.flatMap((z) => z.tables)
                  .find((tt) => tt.id === id);
                if (!t) return;
                const ok = await confirmDialog({
                  title: `Delete ${t.label || `Table ${t.number}`}?`,
                  message: 'Active orders on this table must be settled first.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) tableDeleteM.mutate(id);
              }}
              onDeleteDecor={async (id) => {
                const ok = await confirmDialog({
                  title: 'Delete this decor?',
                  message: 'It will be removed from the floor plan.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) decorDeleteM.mutate(id);
              }}
            />
          )}

          {addMenuAnchor && (
            <AddMenu
              anchorX={addMenuAnchor.x}
              anchorY={addMenuAnchor.y}
              canCreateZone={canEditZoneDecor}
              canCreateDecor={canEditZoneDecor}
              onSelect={handleAdd}
              onClose={() => setAddMenuAnchor(null)}
            />
          )}

          {(suggestStatus || suggestCreateM.error) && (
            <div
              style={{
                position: 'absolute',
                bottom: 28,
                left: '50%',
                transform: 'translateX(-50%)',
                background: suggestCreateM.error ? 'rgba(196,80,64,0.08)' : 'rgba(74,140,92,0.1)',
                border: `1px solid ${
                  suggestCreateM.error ? 'rgba(196,80,64,0.3)' : 'rgba(74,140,92,0.3)'
                }`,
                color: suggestCreateM.error ? 'var(--red)' : 'var(--green)',
                borderRadius: 999,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {suggestCreateM.error
                ? suggestCreateM.error instanceof ApiError
                  ? suggestCreateM.error.message
                  : 'Suggestion failed'
                : suggestStatus}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toolbarTitle(sel: InspectorSelection): string {
  if (sel.kind === 'table') return sel.table.label || `Table ${sel.table.number}`;
  if (sel.kind === 'zone') return sel.zone.name;
  return sel.decor.type === 'BAR_COUNTER' ? sel.decor.label || 'Bar' : 'Plant';
}
