import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type {
  DecorTypeValue,
  FloorDecor,
  FloorTable,
  FloorZone,
  TableShapeValue,
  TableStatusValue,
} from '../../api/floors';

const drawer: CSSProperties = {
  position: 'absolute',
  right: 16,
  top: 16,
  bottom: 16,
  width: 300,
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  padding: 18,
  overflowY: 'auto',
  zIndex: 16,
  fontFamily: 'inherit',
};

const heading: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  fontSize: 19,
  margin: 0,
};
const sub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text2)',
  marginBottom: 14,
  marginTop: 2,
};
const fieldStyle: CSSProperties = { marginBottom: 12 };
const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'var(--text2)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 5,
  fontWeight: 600,
};
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
  background: '#fff',
  color: 'var(--text1)',
  outline: 'none',
};
const rowStyle: CSSProperties = { display: 'flex', gap: 8 };
const swatchRow: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const swatchStyle = (active: boolean): CSSProperties => ({
  width: 26,
  height: 26,
  borderRadius: 5,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  boxShadow: active ? '0 0 0 2px var(--text1)' : 'none',
  background: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

const footer: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 14,
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
};
const primaryBtn: CSSProperties = {
  flex: 1,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 38,
};
const dangerBtn: CSSProperties = {
  flex: 1,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.3)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 38,
};

// Discriminated union for the selected element. Caller passes the full record
// (FloorTable | FloorZone | FloorDecor) so we can show kind-specific fields.
export type InspectorSelection =
  | { kind: 'table'; table: FloorTable; zoneName: string }
  | { kind: 'zone'; zone: FloorZone }
  | { kind: 'decor'; decor: FloorDecor };

interface ZonePatch {
  name?: string;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
}
interface TablePatch {
  label?: string | null;
  shape?: TableShapeValue;
  width?: number;
  height?: number;
  rotation?: number;
  status?: TableStatusValue;
}
interface DecorPatch {
  label?: string | null;
  width?: number;
  height?: number;
  rotation?: number;
}

interface Props {
  selection: InspectorSelection;
  canDelete: boolean;
  onSaveZone: (id: string, patch: ZonePatch) => void;
  onSaveTable: (id: string, patch: TablePatch) => void;
  onSaveDecor: (id: string, patch: DecorPatch) => void;
  onDeleteZone: (id: string) => void;
  onDeleteTable: (id: string) => void;
  onDeleteDecor: (id: string) => void;
}

const TABLE_STATUSES: TableStatusValue[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED'];

export function Inspector({
  selection,
  canDelete,
  onSaveZone,
  onSaveTable,
  onSaveDecor,
  onDeleteZone,
  onDeleteTable,
  onDeleteDecor,
}: Props) {
  // Local form state. Re-derived whenever the selection key flips so editing
  // a different element resets the inputs to its current values.
  const key = selection.kind + ':' + selectionId(selection);
  const [draft, setDraft] = useState(() => initialDraft(selection));
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    setDraft(initialDraft(selection));
    setSavedFlash(false);
  }, [key]);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1100);
  };

  if (selection.kind === 'zone') {
    const z = selection.zone;
    return (
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        <h4 style={heading}>{z.name}</h4>
        <div style={sub}>Zone</div>
        <Field label="Name">
          <input
            style={inputStyle}
            value={draft.name ?? z.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <div style={rowStyle}>
          <Field label="X">
            <input
              type="number"
              style={inputStyle}
              value={draft.pos_x ?? z.pos_x}
              onChange={(e) => setDraft({ ...draft, pos_x: Number(e.target.value) })}
            />
          </Field>
          <Field label="Y">
            <input
              type="number"
              style={inputStyle}
              value={draft.pos_y ?? z.pos_y}
              onChange={(e) => setDraft({ ...draft, pos_y: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div style={rowStyle}>
          <Field label="Width">
            <input
              type="number"
              style={inputStyle}
              value={draft.width ?? z.width}
              onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              style={inputStyle}
              value={draft.height ?? z.height}
              onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div style={footer}>
          <button
            type="button"
            style={primaryBtn}
            onClick={() => {
              onSaveZone(z.id, {
                name: draft.name,
                pos_x: draft.pos_x,
                pos_y: draft.pos_y,
                width: draft.width,
                height: draft.height,
              });
              flashSaved();
            }}
          >
            {savedFlash ? '✓ Saved' : 'Save'}
          </button>
          {canDelete && (
            <button type="button" style={dangerBtn} onClick={() => onDeleteZone(z.id)}>
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selection.kind === 'table') {
    const t = selection.table;
    const shape = (draft.shape ?? t.shape) as TableShapeValue;
    const status = (draft.status ?? t.status) as TableStatusValue;
    return (
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        <h4 style={heading}>{t.label || `Table ${t.number}`}</h4>
        <div style={sub}>Table in {selection.zoneName}</div>
        <Field label="Custom label (overrides number)">
          <input
            style={inputStyle}
            value={draft.label ?? t.label ?? ''}
            placeholder={String(t.number)}
            onChange={(e) =>
              setDraft({ ...draft, label: e.target.value === '' ? null : e.target.value })
            }
          />
        </Field>
        <Field label="Shape">
          <div style={swatchRow}>
            <button
              type="button"
              style={swatchStyle(shape === 'TABLE_RECT')}
              onClick={() => setDraft({ ...draft, shape: 'TABLE_RECT' })}
              title="Rectangle"
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: '#fff',
                  border: '1.5px solid var(--text1)',
                }}
              />
            </button>
            <button
              type="button"
              style={swatchStyle(shape === 'TABLE_CIRCLE')}
              onClick={() => setDraft({ ...draft, shape: 'TABLE_CIRCLE' })}
              title="Circle"
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: '#fff',
                  border: '1.5px solid var(--text1)',
                  borderRadius: '50%',
                }}
              />
            </button>
          </div>
        </Field>
        <div style={rowStyle}>
          <Field label="Width">
            <input
              type="number"
              style={inputStyle}
              value={draft.width ?? t.width}
              onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              style={inputStyle}
              value={draft.height ?? t.height}
              onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Rotation (°)">
          <input
            type="number"
            min={0}
            max={359}
            style={inputStyle}
            value={draft.rotation ?? t.rotation}
            onChange={(e) =>
              setDraft({ ...draft, rotation: Number(e.target.value) % 360 })
            }
          />
        </Field>
        <Field label="Status">
          <select
            style={inputStyle}
            value={status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as TableStatusValue })}
          >
            {TABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <div style={footer}>
          <button
            type="button"
            style={primaryBtn}
            onClick={() => {
              onSaveTable(t.id, {
                label: draft.label,
                shape: draft.shape,
                width: draft.width,
                height: draft.height,
                rotation: draft.rotation,
                status: draft.status,
              });
              flashSaved();
            }}
          >
            {savedFlash ? '✓ Saved' : 'Save'}
          </button>
          {canDelete && (
            <button type="button" style={dangerBtn} onClick={() => onDeleteTable(t.id)}>
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  // Decor
  const d = selection.decor;
  const isBar = d.type === ('BAR_COUNTER' as DecorTypeValue);
  return (
    <div style={drawer} onClick={(e) => e.stopPropagation()}>
      <h4 style={heading}>{isBar ? d.label || 'Bar' : 'Plant'}</h4>
      <div style={sub}>{isBar ? 'Bar / counter' : 'Decoration'}</div>
      {isBar && (
        <Field label="Label">
          <input
            style={inputStyle}
            value={draft.label ?? d.label ?? ''}
            placeholder="Bar"
            onChange={(e) =>
              setDraft({ ...draft, label: e.target.value === '' ? null : e.target.value })
            }
          />
        </Field>
      )}
      <div style={rowStyle}>
        <Field label="Width">
          <input
            type="number"
            style={inputStyle}
            value={draft.width ?? d.width}
            onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            style={inputStyle}
            value={draft.height ?? d.height}
            onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Rotation (°)">
        <input
          type="number"
          min={0}
          max={359}
          style={inputStyle}
          value={draft.rotation ?? d.rotation}
          onChange={(e) =>
            setDraft({ ...draft, rotation: Number(e.target.value) % 360 })
          }
        />
      </Field>
      <div style={footer}>
        <button
          type="button"
          style={primaryBtn}
          onClick={() => {
            onSaveDecor(d.id, {
              label: draft.label,
              width: draft.width,
              height: draft.height,
              rotation: draft.rotation,
            });
            flashSaved();
          }}
        >
          {savedFlash ? '✓ Saved' : 'Save'}
        </button>
        {canDelete && (
          <button type="button" style={dangerBtn} onClick={() => onDeleteDecor(d.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface DraftState {
  name?: string;
  label?: string | null;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: TableShapeValue;
  status?: TableStatusValue;
}

function initialDraft(_sel: InspectorSelection): DraftState {
  return {};
}

function selectionId(sel: InspectorSelection): string {
  if (sel.kind === 'table') return sel.table.id;
  if (sel.kind === 'zone') return sel.zone.id;
  return sel.decor.id;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
