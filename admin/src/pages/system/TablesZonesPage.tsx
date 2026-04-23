import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import {
  useCreateTable,
  useDeleteTable,
  useUpdateTableStatus,
  useUpdateTable,
} from '../../hooks/useTables';
import { useDeleteZone, useZones } from '../../hooks/useZones';
import type {
  Table,
  TableStatus,
  Zone,
  ZoneWithTables,
} from '../../types/operations';
import { TABLE_STATUSES, tableStatusLabel } from '../../types/operations';
import { tableStatusTone } from '../staff/operations-meta';
import { ZoneFormModal } from './ZoneFormModal';

export function TablesZonesPage() {
  // include_tables=true gives us zones + their tables in one round-trip,
  // sized for typical restaurants (a few zones, maybe 10–30 tables each).
  const zonesQ = useZones({ include_tables: true });
  const deleteZoneM = useDeleteZone();

  const [editingZone, setEditingZone] = useState<{ open: boolean; zone: Zone | null }>(
    { open: false, zone: null },
  );

  const zones = useMemo<ZoneWithTables[]>(
    () => (zonesQ.data?.items ?? []) as ZoneWithTables[],
    [zonesQ.data],
  );

  const onDeleteZone = async (zone: Zone) => {
    if (
      !confirm(
        `Delete zone "${zone.name}"? Its tables will be deactivated. Open orders block deletion.`,
      )
    ) {
      return;
    }
    try {
      await deleteZoneM.mutateAsync(zone.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (zonesQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading zones…
      </div>
    );
  }

  if (zonesQ.error) {
    return (
      <EmptyState
        icon="⚠"
        message="Couldn't load zones"
        sub={(zonesQ.error as Error).message}
      />
    );
  }

  return (
    <>
      <div className="toolbar mb-12">
        <div style={{ flex: 1 }}>
          <p className="fs-12 text-muted" style={{ margin: 0 }}>
            Group tables into zones (Indoor, Terrace, Bar). Status auto-updates as
            orders open and settle — flip a table RESERVED to hold it manually.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setEditingZone({ open: true, zone: null })}
        >
          + New zone
        </Button>
      </div>

      {zones.length === 0 ? (
        <EmptyState
          message="No zones yet"
          sub="Create a zone (e.g. Indoor) and add tables to it."
          action={
            <Button
              variant="primary"
              onClick={() => setEditingZone({ open: true, zone: null })}
            >
              + New zone
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {zones.map((zone) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              onEditZone={(z) => setEditingZone({ open: true, zone: z })}
              onDeleteZone={onDeleteZone}
              deletingZone={deleteZoneM.isPending}
            />
          ))}
        </div>
      )}

      <ZoneFormModal
        open={editingZone.open}
        onClose={() => setEditingZone({ open: false, zone: null })}
        zone={editingZone.zone}
      />
    </>
  );
}

/* ───────────────── Single zone card ──────────────────── */

interface ZoneCardProps {
  zone: ZoneWithTables;
  onEditZone: (zone: Zone) => void;
  onDeleteZone: (zone: Zone) => void;
  deletingZone: boolean;
}

function ZoneCard({ zone, onEditZone, onDeleteZone, deletingZone }: ZoneCardProps) {
  const activeTables = (zone.tables ?? []).filter((t) => t.active);
  const inactiveCount = (zone.tables ?? []).length - activeTables.length;

  // Card.title wraps content in <h2>, so the meta + badges go in `actions`
  // (which sits to the right of the title) to keep the markup semantic.
  const meta = (
    <div className="flex gap-12" style={{ alignItems: 'center' }}>
      <span className="fs-11 text-muted">
        order {zone.display_order} · {activeTables.length} table
        {activeTables.length === 1 ? '' : 's'}
        {inactiveCount > 0 && ` (+${inactiveCount} inactive)`}
      </span>
      {!zone.active && <Badge tone="gray">Inactive</Badge>}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onEditZone(zone)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onDeleteZone(zone)}
        disabled={deletingZone}
        title="Delete zone"
      >
        ✕
      </button>
    </div>
  );

  return (
    <Card title={zone.name} actions={meta}>
      <TablesGrid zoneId={zone.id} tables={activeTables} />
      <AddTableForm
        zoneId={zone.id}
        existingNumbers={(zone.tables ?? []).map((t) => t.number)}
      />
    </Card>
  );
}

/* ───────────────── Tables list ───────────────────────── */

const TABLE_GRID = '70px 1fr 130px 180px 90px';

function TablesGrid({ zoneId, tables }: { zoneId: string; tables: Table[] }) {
  if (tables.length === 0) {
    return (
      <div
        className="empty-state"
        style={{ padding: '20px 8px', borderBottom: '1px solid var(--border)' }}
      >
        <div className="msg">No tables in this zone yet</div>
        <div className="sub">Use the form below to add the first one.</div>
      </div>
    );
  }
  return (
    <div className="table-wrap" style={{ marginBottom: 12 }}>
      <div
        className="table-head"
        style={{ gridTemplateColumns: TABLE_GRID }}
      >
        <div>Number</div>
        <div>Capacity</div>
        <div>Status</div>
        <div>Quick set</div>
        <div></div>
      </div>
      {tables.map((t, idx) => (
        <TableRow key={t.id} table={t} zoneId={zoneId} even={idx % 2 === 0} />
      ))}
    </div>
  );
}

interface TableRowProps {
  table: Table;
  zoneId: string;
  even: boolean;
}

function TableRow({ table, even }: TableRowProps) {
  const updateM = useUpdateTable();
  const statusM = useUpdateTableStatus();
  const deleteM = useDeleteTable();

  // Local inline edit for capacity — commits on blur if changed, snaps back
  // to the persisted value on cancel/escape so transient typos don't strand
  // an invalid number on the server.
  const [capDraft, setCapDraft] = useState(String(table.capacity));
  const persistedCap = String(table.capacity);

  const commitCapacity = async () => {
    if (capDraft === persistedCap) return;
    const parsed = Number(capDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      setCapDraft(persistedCap);
      return;
    }
    try {
      await updateM.mutateAsync({ id: table.id, input: { capacity: parsed } });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
      setCapDraft(persistedCap);
    }
  };

  const onChangeStatus = (status: TableStatus) => {
    statusM.mutate({ id: table.id, status });
  };

  const onDelete = async () => {
    if (
      !confirm(
        `Delete table ${table.number}? It will be deactivated. Open orders block deletion.`,
      )
    ) {
      return;
    }
    try {
      await deleteM.mutateAsync(table.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div
      className={`table-row ${even ? 'even' : 'odd'}`}
      style={{ gridTemplateColumns: TABLE_GRID, alignItems: 'center' }}
    >
      <div className="fw-600 fs-13">#{table.number}</div>
      <div>
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          className={`inline-input${updateM.isPending ? ' saving' : ''}`}
          style={{ width: 80 }}
          value={capDraft}
          onChange={(e) => setCapDraft(e.target.value)}
          onBlur={commitCapacity}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setCapDraft(persistedCap);
          }}
        />
        <span className="fs-11 text-muted" style={{ marginLeft: 8 }}>
          seat{Number(capDraft) === 1 ? '' : 's'}
        </span>
      </div>
      <div>
        <Badge tone={tableStatusTone(table.status)}>
          {tableStatusLabel(table.status)}
        </Badge>
      </div>
      <div>
        <select
          className={`inline-select${statusM.isPending ? ' saving' : ''}`}
          value={table.status}
          onChange={(e) => onChangeStatus(e.target.value as TableStatus)}
          style={{ width: 160 }}
        >
          {TABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tableStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onDelete}
          disabled={deleteM.isPending}
          title="Delete table"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ───────────────── Inline add-table form ─────────────── */

function AddTableForm({
  zoneId,
  existingNumbers,
}: {
  zoneId: string;
  existingNumbers: number[];
}) {
  const createM = useCreateTable();
  // Default the next-table number to one past the highest already used; falls
  // back to 1 for empty zones.
  const suggestedNumber =
    existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1;
  const [number, setNumber] = useState(String(suggestedNumber));
  const [capacity, setCapacity] = useState('2');
  const [error, setError] = useState<string | null>(null);

  // When the suggested number changes (e.g. user added a table just above),
  // sync the input so the next add is one click away.
  if (number === '' && suggestedNumber > 0) {
    setNumber(String(suggestedNumber));
  }

  const submit = async () => {
    setError(null);
    const num = Number(number);
    const cap = Number(capacity);
    if (!Number.isInteger(num) || num < 1) {
      setError('Number must be a positive whole number');
      return;
    }
    if (existingNumbers.includes(num)) {
      setError(`Table ${num} already exists in this zone`);
      return;
    }
    if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
      setError('Capacity must be 1–100');
      return;
    }
    try {
      await createM.mutateAsync({ zone_id: zoneId, number: num, capacity: cap });
      // Reset for the next add.
      setNumber(String(num + 1));
      setCapacity('2');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add table');
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 160px auto',
        gap: 10,
        alignItems: 'end',
        padding: '10px 0 4px',
        borderTop: '1px solid var(--border)',
      }}
    >
      <Field label="Table #">
        <input
          type="number"
          min="1"
          step="1"
          className="inline-input"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </Field>
      <Field label="Capacity (seats)">
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          className="inline-input"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </Field>
      <Button variant="primary" onClick={submit} loading={createM.isPending}>
        + Add table
      </Button>
      {error && (
        <div
          className="auth-alert"
          style={{ gridColumn: '1 / -1', marginTop: 8 }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="fs-11 text-muted"
        style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
