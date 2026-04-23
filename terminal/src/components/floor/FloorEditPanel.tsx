import { useEffect, useState } from 'react';
import type { FloorTable, FloorZoneLabel, TableShape } from '../../types/api';

export interface FloorEditPanelProps {
  selection:
    | { kind: 'table'; value: FloorTable }
    | { kind: 'label'; value: FloorZoneLabel }
    | null;
  onUpdateTable: (
    id: string,
    patch: Partial<{
      label: string | null;
      shape: TableShape;
      rotation: number;
      capacity: number;
      number: number;
    }>,
  ) => void;
  onUpdateLabel: (
    id: string,
    patch: Partial<{
      text: string;
      rotation: number;
      font_size: number;
    }>,
  ) => void;
  onDeleteTable: (id: string) => void;
  onDeleteLabel: (id: string) => void;
  onClose: () => void;
}

// Local draft state for the inputs — we push updates on blur or slider commit
// so the backend isn't hammered on every keystroke. Labels/numbers save on
// blur, enums/sliders on change.
export function FloorEditPanel(props: FloorEditPanelProps) {
  const { selection, onUpdateTable, onUpdateLabel, onDeleteTable, onDeleteLabel, onClose } = props;

  const [draftLabel, setDraftLabel] = useState('');
  const [draftCapacity, setDraftCapacity] = useState('');
  const [draftNumber, setDraftNumber] = useState('');
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'table') {
      setDraftLabel(selection.value.label ?? '');
      setDraftCapacity(String(selection.value.capacity));
      setDraftNumber(String(selection.value.number));
    } else {
      setDraftText(selection.value.text);
    }
  }, [selection]);

  if (!selection) return null;

  if (selection.kind === 'table') {
    const table = selection.value;
    return (
      <aside className="floor-edit-panel">
        <header>
          <h3>Edit table</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="panel-field">
          <label>Label</label>
          <input
            type="text"
            value={draftLabel}
            placeholder={`Table ${table.number}`}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={() => {
              const next = draftLabel.trim();
              onUpdateTable(table.id, { label: next === '' ? null : next });
            }}
          />
          <p className="hint">Blank uses the table number.</p>
        </div>
        <div className="panel-field-row">
          <div className="panel-field">
            <label>Number</label>
            <input
              type="number"
              min={1}
              value={draftNumber}
              onChange={(e) => setDraftNumber(e.target.value)}
              onBlur={() => {
                const n = Number.parseInt(draftNumber, 10);
                if (Number.isFinite(n) && n > 0 && n !== table.number) {
                  onUpdateTable(table.id, { number: n });
                } else {
                  setDraftNumber(String(table.number));
                }
              }}
            />
          </div>
          <div className="panel-field">
            <label>Seats</label>
            <input
              type="number"
              min={1}
              value={draftCapacity}
              onChange={(e) => setDraftCapacity(e.target.value)}
              onBlur={() => {
                const n = Number.parseInt(draftCapacity, 10);
                if (Number.isFinite(n) && n > 0 && n !== table.capacity) {
                  onUpdateTable(table.id, { capacity: n });
                } else {
                  setDraftCapacity(String(table.capacity));
                }
              }}
            />
          </div>
        </div>
        <div className="panel-field">
          <label>Shape</label>
          <div className="shape-toggle">
            <button
              type="button"
              className={table.shape === 'TABLE_RECT' ? 'active' : ''}
              onClick={() => onUpdateTable(table.id, { shape: 'TABLE_RECT' })}
            >
              <span className="shape-rect" /> Rectangle
            </button>
            <button
              type="button"
              className={table.shape === 'TABLE_CIRCLE' ? 'active' : ''}
              onClick={() => onUpdateTable(table.id, { shape: 'TABLE_CIRCLE' })}
            >
              <span className="shape-circle" /> Circle
            </button>
          </div>
        </div>
        <div className="panel-field">
          <label>Rotation · {table.rotation}°</label>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={table.rotation}
            onChange={(e) => onUpdateTable(table.id, { rotation: Number(e.target.value) })}
          />
        </div>
        <div className="panel-footer">
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => {
              if (confirm(`Delete table ${table.label ?? table.number}?`)) {
                onDeleteTable(table.id);
              }
            }}
          >
            Delete table
          </button>
        </div>
      </aside>
    );
  }

  const label = selection.value;
  return (
    <aside className="floor-edit-panel">
      <header>
        <h3>Edit label</h3>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="panel-field">
        <label>Text</label>
        <input
          type="text"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => {
            const next = draftText.trim();
            if (next && next !== label.text) {
              onUpdateLabel(label.id, { text: next });
            } else {
              setDraftText(label.text);
            }
          }}
        />
      </div>
      <div className="panel-field">
        <label>Font size · {label.font_size}px</label>
        <input
          type="range"
          min={12}
          max={72}
          step={1}
          value={label.font_size}
          onChange={(e) => onUpdateLabel(label.id, { font_size: Number(e.target.value) })}
        />
      </div>
      <div className="panel-field">
        <label>Rotation · {label.rotation}°</label>
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={label.rotation}
          onChange={(e) => onUpdateLabel(label.id, { rotation: Number(e.target.value) })}
        />
      </div>
      <div className="panel-footer">
        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={() => {
            if (confirm('Delete this label?')) onDeleteLabel(label.id);
          }}
        >
          Delete label
        </button>
      </div>
    </aside>
  );
}
