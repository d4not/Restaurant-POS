import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTable,
  createZoneLabel,
  deleteTable as apiDeleteTable,
  deleteZoneLabel as apiDeleteZoneLabel,
  getFloors,
  patchTable,
  patchZoneLabel,
} from '../api/floors';
import { createOrder } from '../api/orders';
import { useOpenRegister } from '../hooks/useOpenRegister';
import { hasRole, useSessionStore } from '../store/session';
import { useToastStore } from '../store/toast';
import { ApiError } from '../api/client';
import type { FloorTable, FloorZone, FloorZoneLabel } from '../types/api';
import { FloorCanvas } from '../components/floor/FloorCanvas';
import { FloorEditPanel } from '../components/floor/FloorEditPanel';

const POLL_INTERVAL_MS = 10_000;
// Roles that can edit the floor plan. Waiters use the layout; they don't
// re-arrange it. Matches the cashier-tier permissions already in the store.
const ROLES_CAN_EDIT_FLOOR: Array<'CASHIER' | 'MANAGER' | 'ADMIN'> = ['CASHIER', 'MANAGER', 'ADMIN'];

export function FloorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const user = useSessionStore((s) => s.user);
  const canEdit = hasRole(user, ROLES_CAN_EDIT_FLOOR);

  const [editMode, setEditMode] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selection, setSelection] = useState<{
    id: string;
    kind: 'table' | 'label';
  } | null>(null);

  const floorsQuery = useQuery({
    queryKey: ['floors'],
    queryFn: getFloors,
    // Poll in view mode so badges stay fresh. In edit mode we'd rather not
    // have the canvas snap back after an in-flight PATCH, so pause polling.
    refetchInterval: editMode ? false : POLL_INTERVAL_MS,
  });

  const register = useOpenRegister();

  const zones = useMemo<FloorZone[]>(() => floorsQuery.data ?? [], [floorsQuery.data]);

  const resolvedSelection = useMemo(() => {
    if (!selection) return null;
    for (const zone of zones) {
      if (selection.kind === 'table') {
        const t = zone.tables.find((x) => x.id === selection.id);
        if (t) return { kind: 'table' as const, value: t };
      } else {
        const l = zone.labels.find((x) => x.id === selection.id);
        if (l) return { kind: 'label' as const, value: l };
      }
    }
    return null;
  }, [selection, zones]);

  // ── Mutations ────────────────────────────────────────────────────────

  const createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${order.id}`);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not create order';
      pushToast(message, 'error');
    },
  });

  const patchTableMutation = useMutation({
    mutationFn: (args: Parameters<typeof patchTable>) => patchTable(args[0], args[1]),
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not update table';
      pushToast(message, 'error');
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });

  const patchLabelMutation = useMutation({
    mutationFn: (args: Parameters<typeof patchZoneLabel>) =>
      patchZoneLabel(args[0], args[1]),
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not update label';
      pushToast(message, 'error');
      queryClient.invalidateQueries({ queryKey: ['floors'] });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['floors'] }),
  });

  const createTableMutation = useMutation({
    mutationFn: createTable,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setSelection({ id: created.id, kind: 'table' });
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not create table';
      pushToast(message, 'error');
    },
  });

  const createLabelMutation = useMutation({
    mutationFn: createZoneLabel,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setSelection({ id: created.id, kind: 'label' });
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not create label';
      pushToast(message, 'error');
    },
  });

  const deleteTableMutation = useMutation({
    mutationFn: apiDeleteTable,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setSelection(null);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not delete table';
      pushToast(message, 'error');
    },
  });

  const deleteLabelMutation = useMutation({
    mutationFn: apiDeleteZoneLabel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setSelection(null);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not delete label';
      pushToast(message, 'error');
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────

  function openTable(table: FloorTable) {
    if (table.status === 'OCCUPIED' && table.current_order) {
      navigate(`/orders/${table.current_order.id}`);
      return;
    }
    if (!register.data) {
      pushToast('Open a cash register to start an order', 'error');
      return;
    }
    createOrderMutation.mutate({
      register_id: register.data.id,
      order_type: 'DINE_IN',
      table_id: table.id,
    });
  }

  function startTakeout() {
    if (!register.data) {
      pushToast('Open a cash register to start an order', 'error');
      return;
    }
    createOrderMutation.mutate({
      register_id: register.data.id,
      order_type: 'TAKEOUT',
    });
  }

  function handleAddTable() {
    const zone = zones[0];
    if (!zone) {
      pushToast('Create a zone in the admin panel first', 'error');
      return;
    }
    // Pick the next free number within the chosen zone. Server enforces
    // uniqueness per-zone; this client-side pick just gives the user a
    // predictable number without a round-trip.
    const existingNumbers = new Set(zone.tables.map((t) => t.number));
    let nextNumber = 1;
    while (existingNumbers.has(nextNumber)) nextNumber += 1;
    createTableMutation.mutate({
      zone_id: zone.id,
      number: nextNumber,
      capacity: 4,
      pos_x: 200,
      pos_y: 160,
      width: 120,
      height: 120,
      shape: 'TABLE_RECT',
    });
  }

  function handleAddLabel() {
    const zone = zones[0];
    if (!zone) {
      pushToast('Create a zone in the admin panel first', 'error');
      return;
    }
    createLabelMutation.mutate({
      zone_id: zone.id,
      text: 'New label',
      pos_x: 240,
      pos_y: 120,
      width: 220,
      height: 48,
      font_size: 24,
    });
  }

  return (
    <div className="page floor-page">
      <header className="page-header">
        <div className="title">
          <div className="crumb">Service</div>
          <h1>Floor Plan</h1>
        </div>
        <div className="floor-actions">
          {canEdit && !editMode && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEditMode(true)}
            >
              Edit layout
            </button>
          )}
          {editMode && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleAddLabel}
                disabled={createLabelMutation.isPending}
              >
                + Label
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleAddTable}
                disabled={createTableMutation.isPending}
              >
                + Table
              </button>
              <label className="grid-toggle">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(e) => setSnapToGrid(e.target.checked)}
                />
                <span>Snap to grid</span>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditMode(false);
                  setSelection(null);
                }}
              >
                Done
              </button>
            </>
          )}
        </div>
      </header>

      {!register.isLoading && !register.data && !editMode && (
        <div className="register-banner">
          <div className="msg">
            No open cash register — open a shift to start taking orders.
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/register')}
          >
            Open Register
          </button>
        </div>
      )}

      {floorsQuery.isLoading && (
        <div className="empty">
          <div className="title">Loading floor…</div>
        </div>
      )}

      {floorsQuery.error && (
        <div className="empty">
          <div className="icon">!</div>
          <div className="title">Could not load floors</div>
          <div>{(floorsQuery.error as Error).message}</div>
        </div>
      )}

      {floorsQuery.data && zones.length === 0 && (
        <div className="empty">
          <div className="icon">⌂</div>
          <div className="title">No zones configured</div>
          <div>Set up zones in the admin panel to get started.</div>
        </div>
      )}

      {zones.length > 0 && (
        <div className="floor-stage">
          <FloorCanvas
            zones={zones}
            editMode={editMode}
            selectedId={selection?.id ?? null}
            selectedKind={selection?.kind ?? null}
            onSelect={(id, kind) => {
              if (id && kind) setSelection({ id, kind });
              else setSelection(null);
            }}
            onTableTap={openTable}
            onMoveTable={(id, pos) => patchTableMutation.mutate([id, pos])}
            onResizeTable={(id, rect) => patchTableMutation.mutate([id, rect])}
            onMoveLabel={(id, pos) => patchLabelMutation.mutate([id, pos])}
            onResizeLabel={(id, rect) => patchLabelMutation.mutate([id, rect])}
            snapToGrid={snapToGrid}
          />

          {editMode && resolvedSelection && (
            <FloorEditPanel
              selection={resolvedSelection as
                | { kind: 'table'; value: FloorTable }
                | { kind: 'label'; value: FloorZoneLabel }}
              onUpdateTable={(id, patch) => patchTableMutation.mutate([id, patch])}
              onUpdateLabel={(id, patch) => patchLabelMutation.mutate([id, patch])}
              onDeleteTable={(id) => deleteTableMutation.mutate(id)}
              onDeleteLabel={(id) => deleteLabelMutation.mutate(id)}
              onClose={() => setSelection(null)}
            />
          )}

          {!editMode && (
            <button
              type="button"
              className="floor-takeout"
              onClick={startTakeout}
              disabled={createOrderMutation.isPending || !register.data}
              title="Create a takeout order (no table)"
            >
              + Takeout
            </button>
          )}
        </div>
      )}
    </div>
  );
}
