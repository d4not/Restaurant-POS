import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { Spinner } from '../Spinner';
import { UnifiedScanPanel, type UnifiedScanResult } from './UnifiedScanPanel';
import { ps, statusDotStyle, PRINTER_TYPES, CHARACTER_SETS } from './styles';
import {
  useCreatePrinter,
  useUpdatePrinter,
  useDeletePrinter,
} from '../../hooks/usePrinters';
import type { Printer } from '../../api/printers';
import type { PrinterProfile } from '../../api/printer-profiles';

interface Props {
  printers: Printer[];
  printersStatus: Record<string, boolean>;
  profiles: PrinterProfile[];
  canEdit: boolean;
  loading: boolean;
}

export function PrinterListTab({ printers, printersStatus, profiles, canEdit, loading }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const createMut = useCreatePrinter();
  const updateMut = useUpdatePrinter();
  const deleteMut = useDeletePrinter();

  function profileCountForPrinter(printerId: string): number {
    return profiles.filter((p) => p.printer_id === printerId).length;
  }

  async function handleDelete(id: string) {
    await deleteMut.mutateAsync(id);
    setConfirmDelete(null);
  }

  if (loading) {
    return (
      <div style={loadingWrap}>
        <Spinner size={20} /> {t('settings.loadingPrinterConfig')}
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      {canEdit && editing === null && (
        <div style={topRow}>
          <button
            type="button"
            style={addBtn}
            onClick={() => setEditing('new')}
          >
            + {t('printers.newPrinter')}
          </button>
        </div>
      )}

      {/* Inline editor */}
      {editing !== null && (
        <PrinterInlineEditor
          printer={editing === 'new' ? null : editing}
          saving={createMut.isPending || updateMut.isPending}
          onSave={async (input) => {
            if (editing === 'new') {
              await createMut.mutateAsync(input);
            } else {
              await updateMut.mutateAsync({ id: editing.id, input });
            }
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Printer list */}
      {printers.length === 0 && editing === null && (
        <div style={emptyState}>
          <div style={emptyIcon}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text2)', marginBottom: 4 }}>
            {t('printers.emptyPrinters')}
          </div>
          {canEdit && (
            <button type="button" style={{ ...addBtn, marginTop: 14 }} onClick={() => setEditing('new')}>
              + {t('printers.newPrinter')}
            </button>
          )}
        </div>
      )}

      {printers.length > 0 && (
        <div style={listWrap}>
          {/* Table header */}
          <div style={listHeader}>
            <span style={{ width: 12 }} />
            <span style={colName}>{t('printers.printerName')}</span>
            <span style={colAddr}>{t('settings.ipLabel')}</span>
            <span style={colModel}>{t('printers.printerModel')}</span>
            <span style={colWidth}>{t('settings.paperWidthChars')}</span>
            <span style={colProfiles}>{t('printers.tabProfiles')}</span>
            <span style={colActions} />
          </div>

          {printers.map((printer, idx) => {
            const connected = printer.address ? (printersStatus[printer.id] ?? null) : null;
            const pCount = profileCountForPrinter(printer.id);
            const isOdd = idx % 2 === 1;

            return (
              <div key={printer.id}>
                <div style={{ ...listRow, background: isOdd ? '#f3ede3' : 'var(--bg2)' }}>
                  <span style={statusDotStyle(connected)} />
                  <span style={rowName}>{printer.name}</span>
                  <span style={rowAddr}>
                    {printer.address || <em style={{ color: 'var(--text3)' }}>{t('printers.noPrinter')}</em>}
                  </span>
                  <span style={rowModel}>{printer.printer_model}</span>
                  <span style={rowWidth}>
                    {printer.paper_width === 32 ? '58mm' : printer.paper_width === 42 ? '76mm' : '80mm'}
                  </span>
                  <span style={rowProfiles(pCount)}>
                    {pCount > 0
                      ? t('printers.usedByProfiles').replace('{count}', String(pCount))
                      : '—'}
                  </span>
                  {canEdit && (
                    <div style={rowActions}>
                      <button type="button" style={editBtn} onClick={() => setEditing(printer)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" style={delBtn} onClick={() => setConfirmDelete(printer.id)}>
                        &times;
                      </button>
                    </div>
                  )}
                </div>

                {confirmDelete === printer.id && (
                  <div style={confirmBar}>
                    <span>
                      {t('printers.deletePrinter')
                        .replace('{name}', printer.name)}
                    </span>
                    <button type="button" style={confirmYes} onClick={() => handleDelete(printer.id)} disabled={deleteMut.isPending}>
                      {deleteMut.isPending ? <Spinner size={10} /> : null} {t('common.delete')}
                    </button>
                    <button type="button" style={confirmNo} onClick={() => setConfirmDelete(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Inline Printer Editor ─────────────────────────────────────────────────

interface EditorProps {
  printer: Printer | null;
  saving: boolean;
  onSave: (input: {
    name: string;
    connection_type: 'NETWORK' | 'USB';
    address: string;
    paper_width: number;
    printer_model: string;
    character_set: string;
  }) => Promise<void>;
  onCancel: () => void;
}

function PrinterInlineEditor({ printer, saving, onSave, onCancel }: EditorProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(printer?.name ?? '');
  const [connType, setConnType] = useState<'NETWORK' | 'USB'>(printer?.connection_type ?? 'NETWORK');
  const [address, setAddress] = useState(printer?.address ?? '');
  const [paperWidth, setPaperWidth] = useState(printer?.paper_width ?? 48);
  const [model, setModel] = useState(printer?.printer_model ?? 'epson');
  const [charset, setCharset] = useState(printer?.character_set ?? 'PC850_MULTILINGUAL');
  const [scanOpen, setScanOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleScanSelect(result: UnifiedScanResult) {
    setAddress(result.address);
    setConnType(result.connection as 'NETWORK' | 'USB');
    setScanOpen(false);
  }

  async function handleSubmit() {
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        connection_type: connType,
        address,
        paper_width: paperWidth,
        printer_model: model,
        character_set: charset,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  const canSubmit = name.trim().length > 0 && !saving;

  return (
    <div style={editorCard}>
      <h3 style={editorTitle}>
        {printer ? t('printers.editPrinter') : t('printers.newPrinter')}
      </h3>

      {error && (
        <div style={editorError}>{error}</div>
      )}

      {/* Name */}
      <div style={ps.field}>
        <label style={ps.label}>{t('printers.printerName')}</label>
        <input
          style={ps.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('printers.printerNamePlaceholder')}
        />
      </div>

      {/* Connection + Model */}
      <div style={{ ...ps.fieldRow, marginTop: 10 }}>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.connection')}</label>
          <select
            style={ps.select}
            value={connType}
            onChange={(e) => setConnType(e.target.value as 'NETWORK' | 'USB')}
          >
            <option value="NETWORK">{t('settings.connectionNetwork')}</option>
            <option value="USB">{t('settings.connectionUsb')}</option>
          </select>
        </div>
        <div style={ps.field}>
          <label style={ps.label}>{t('printers.printerModel')}</label>
          <select style={ps.select} value={model} onChange={(e) => setModel(e.target.value)}>
            {PRINTER_TYPES.map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Address */}
      <div style={ps.field}>
        <label style={ps.label}>
          {connType === 'NETWORK' ? t('settings.ipLabel') : t('settings.deviceLabel')}
        </label>
        <div style={ps.addressRow}>
          <input
            style={{ ...ps.input, flex: 1, minWidth: 0 }}
            value={address}
            placeholder={connType === 'NETWORK' ? '192.168.1.100:9100' : '/dev/usb/lp0'}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      </div>

      {/* Scanner */}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          style={scanOpen ? ps.primaryBtn : ps.ghostBtn}
          onClick={() => setScanOpen((o) => !o)}
        >
          {scanOpen ? t('common.close') : t('printers.scanAll')}
        </button>
      </div>
      {scanOpen && <UnifiedScanPanel onSelect={handleScanSelect} />}

      {/* Paper width + Charset */}
      <div style={{ ...ps.fieldRow, marginTop: 12 }}>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.paperWidthChars')}</label>
          <select
            style={ps.select}
            value={paperWidth}
            onChange={(e) => setPaperWidth(Number(e.target.value))}
          >
            <option value={32}>32 &mdash; 58mm</option>
            <option value={42}>42 &mdash; 76mm</option>
            <option value={48}>48 &mdash; 80mm</option>
          </select>
        </div>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.charset')}</label>
          <select style={ps.select} value={charset} onChange={(e) => setCharset(e.target.value)}>
            {CHARACTER_SETS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div style={editorActions}>
        <button type="button" style={ps.primaryBtn} onClick={handleSubmit} disabled={!canSubmit}>
          {saving ? <Spinner size={12} /> : null}
          {printer ? t('settings.saveChanges') : t('printers.newPrinter')}
        </button>
        <button type="button" style={ps.ghostBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const loadingWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: '60px 24px',
  color: 'var(--text2)',
};

const topRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: 14,
};

const addBtn: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid rgba(44,36,32,0.08)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const emptyState: React.CSSProperties = {
  textAlign: 'center',
  padding: '60px 24px',
  color: 'var(--text3)',
};

const emptyIcon: React.CSSProperties = {
  marginBottom: 12,
  opacity: 0.5,
};

const listWrap: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
};

const GRID_COLS = '12px 1fr 180px 90px 70px 140px 110px';

const listHeader: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID_COLS,
  columnGap: 14,
  padding: '10px 18px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
};

const listRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID_COLS,
  columnGap: 14,
  padding: '12px 18px',
  fontSize: 13,
  color: 'var(--text1)',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
  minHeight: 52,
  transition: 'background 0.1s',
};

const colName: React.CSSProperties = {};
const colAddr: React.CSSProperties = {};
const colModel: React.CSSProperties = {};
const colWidth: React.CSSProperties = {};
const colProfiles: React.CSSProperties = {};
const colActions: React.CSSProperties = {};

const rowName: React.CSSProperties = {
  fontWeight: 600,
};

const rowAddr: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: 'var(--text2)',
};

const rowModel: React.CSSProperties = {
  textTransform: 'capitalize',
  fontSize: 12,
  color: 'var(--text2)',
};

const rowWidth: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
};

const rowProfiles = (count: number): React.CSSProperties => ({
  fontSize: 11,
  color: count > 0 ? 'var(--text2)' : 'var(--text3)',
  fontWeight: count > 0 ? 500 : 400,
});

const rowActions: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  justifyContent: 'flex-end',
};

const editBtn: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const delBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid rgba(196,80,64,0.3)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

const confirmBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  background: 'rgba(196,80,64,0.06)',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
  color: 'var(--red)',
};

const confirmYes: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const confirmNo: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const editorCard: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '18px 20px',
  marginBottom: 18,
  maxWidth: 640,
};

const editorTitle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: '0 0 14px',
};

const editorError: React.CSSProperties = {
  padding: '8px 12px',
  marginBottom: 12,
  borderRadius: 8,
  background: 'rgba(196,80,64,0.10)',
  border: '1px solid rgba(196,80,64,0.4)',
  fontSize: 12,
  color: 'var(--red)',
};

const editorActions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 16,
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
};
