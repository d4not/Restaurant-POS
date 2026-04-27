import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listStorages, type Storage } from '../../api/storages';
import {
  lookupSupplyByBarcode,
  type SupplyBarcodeResult,
} from '../../api/supplies';
import { createTransfer, type CreateTransferInput } from '../../api/transfers';
import { ApiError } from '../../api/client';
import { useBarcodeScanner } from '../../hooks/use-barcode-scanner';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';
import { IconBarcode, IconTrash } from './HubIcons';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
}

interface ScannedRow {
  // Stable client key — barcode is the natural id; if a duplicate scan happens
  // we just bump quantity on the existing row.
  key: string;
  supplyId: string;
  supplyName: string;
  unit: string;
  quantity: number;
}

const localStyles: Record<string, React.CSSProperties> = {
  storageRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginBottom: 14,
  },
  scanWrap: {
    display: 'flex',
    gap: 10,
    alignItems: 'stretch',
    marginBottom: 12,
  },
  scanInput: {
    flex: 1,
    height: 48,
    padding: '0 14px 0 42px',
    border: '2px solid var(--gold)',
    borderRadius: 10,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 15,
    outline: 'none',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  },
  scanIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 20,
    color: 'var(--gold)',
    pointerEvents: 'none',
  },
  scanBox: { position: 'relative', flex: 1 },
  rowsTable: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  th: {
    display: 'grid',
    gridTemplateColumns: '1fr 110px 80px 36px',
    gap: 10,
    padding: '10px 14px',
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)',
  },
  tr: {
    display: 'grid',
    gridTemplateColumns: '1fr 110px 80px 36px',
    gap: 10,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
  trLast: { borderBottom: 'none' },
  qtyControls: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    height: 32,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 28,
    height: 30,
    border: 'none',
    background: 'transparent',
    color: 'var(--text2)',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  qtyVal: {
    minWidth: 32,
    height: 30,
    textAlign: 'center',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    padding: 0,
  },
  removeBtn: {
    width: 32,
    height: 32,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--red)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
  },
  empty: {
    padding: '32px 16px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
};

export function TransferModal({ open, onClose }: TransferModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [rows, setRows] = useState<ScannedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState('');
  // We surface lookup feedback in a transient banner (toast-like) above the
  // table. Replaced by every new scan; cleared after success.
  const [notice, setNotice] = useState<{ kind: 'warn' | 'err'; text: string } | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const noticeTimer = useRef<number | null>(null);

  const storagesQuery = useQuery<Storage[]>({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    enabled: open,
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: (input: CreateTransferInput) => createTransfer(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      // Clear and close — no toast on success since the modal closing is the
      // confirmation. A future improvement could show a banner on the hub.
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT') {
          setError(t('transfer.insufficientStock'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('transfer.failed'));
      }
    },
  });

  // Reset the form whenever the modal re-opens.
  useEffect(() => {
    if (!open) return;
    setRows([]);
    setError(null);
    setScanInput('');
    setNotice(null);
    setFromId('');
    setToId('');
  }, [open]);

  function flashNotice(kind: 'warn' | 'err', text: string) {
    setNotice({ kind, text });
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }

  async function handleScan(code: string) {
    setScanInput('');
    if (!code) return;
    if (!fromId || !toId) {
      flashNotice('warn', t('transfer.pickStoragesFirst'));
      return;
    }
    if (fromId === toId) {
      flashNotice('err', t('transfer.sameStorage'));
      return;
    }
    setLookupBusy(true);
    setError(null);
    try {
      const result: SupplyBarcodeResult = await lookupSupplyByBarcode(code);
      if (!result.existing) {
        if (result.lookup) {
          flashNotice('warn', t('transfer.notFoundCta'));
        } else {
          flashNotice('warn', t('transfer.unknownBarcode'));
        }
        return;
      }
      const hit = result.existing;
      // We need the unit for display — fetch the supply only when this is a
      // first-time scan in this session. Cache hits are deduped automatically
      // because we keep the row keyed by supplyId.
      setRows((prev) => {
        const existing = prev.find((r) => r.supplyId === hit.id);
        if (existing) {
          return prev.map((r) =>
            r.supplyId === hit.id ? { ...r, quantity: r.quantity + 1 } : r,
          );
        }
        return [
          ...prev,
          {
            key: `${hit.id}-${Date.now()}`,
            supplyId: hit.id,
            supplyName: hit.name,
            unit: '',
            quantity: 1,
          },
        ];
      });
    } catch (err) {
      flashNotice('err', err instanceof ApiError ? err.message : t('transfer.lookupFailed'));
    } finally {
      setLookupBusy(false);
    }
  }

  const scanner = useBarcodeScanner({
    onScan: (code) => {
      // The hook fires once per buffer flush. Drain into the controlled input
      // state via handleScan so React doesn't fight the user's manual Enter.
      void handleScan(code);
    },
    enabled: open,
  });

  // Keep focus on the scanner input as much as possible — after every render
  // and after every row mutation. Refocus is a no-op when the user is typing
  // in another field (the browser keeps focus on the active element).
  useEffect(() => {
    if (!open) return;
    scanner.ref.current?.focus();
  }, [open, scanner.ref, rows.length]);

  function setQty(key: string, delta: number | 'set', value?: number) {
    setRows((prev) =>
      prev
        .map((r) => {
          if (r.key !== key) return r;
          const next =
            delta === 'set'
              ? Math.max(1, Math.floor(value ?? 1))
              : Math.max(1, r.quantity + delta);
          return { ...r, quantity: next };
        })
        .filter((r) => r.quantity > 0),
    );
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function submit() {
    setError(null);
    if (!fromId || !toId) {
      setError(t('transfer.pickStoragesFirst'));
      return;
    }
    if (fromId === toId) {
      setError(t('transfer.sameStorage'));
      return;
    }
    if (rows.length === 0) {
      setError(t('transfer.empty'));
      return;
    }
    submitMutation.mutate({
      from_storage_id: fromId,
      to_storage_id: toId,
      date: new Date().toISOString(),
      items: rows.map((r) => ({ supply_id: r.supplyId, quantity: r.quantity })),
    });
  }

  // ESC closes; Enter on the scan input is consumed by the barcode hook.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const storages = storagesQuery.data ?? [];

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div
        style={hubStyles.wideChildModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('transfer.title')}</h2>
          <div style={hubStyles.sub}>{t('transfer.subtitle')}</div>
        </div>

        <div style={hubStyles.body}>
          <div style={localStyles.storageRow}>
            <div style={hubStyles.field}>
              <label style={hubStyles.label}>{t('transfer.fromStorage')}</label>
              <select
                style={hubStyles.select}
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">—</option>
                {storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={hubStyles.field}>
              <label style={hubStyles.label}>{t('transfer.toStorage')}</label>
              <select
                style={hubStyles.select}
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                <option value="">—</option>
                {storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={localStyles.scanWrap}>
            <div style={localStyles.scanBox}>
              <span style={localStyles.scanIcon}>
                <IconBarcode />
              </span>
              <input
                ref={scanner.ref}
                style={localStyles.scanInput}
                placeholder={t('transfer.scanPrompt')}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                disabled={lookupBusy}
                aria-label={t('transfer.scanPrompt')}
              />
            </div>
            {lookupBusy && <Spinner size={18} />}
          </div>
          <div style={hubStyles.hint}>{t('transfer.scanHint')}</div>

          {notice && (
            <div
              style={{
                ...(notice.kind === 'err' ? hubStyles.errBanner : hubStyles.okBanner),
                background:
                  notice.kind === 'warn'
                    ? 'rgba(201,164,92,0.10)'
                    : notice.kind === 'err'
                      ? 'rgba(196,80,64,0.10)'
                      : 'rgba(74,140,92,0.10)',
                color:
                  notice.kind === 'warn'
                    ? '#8a6d2a'
                    : notice.kind === 'err'
                      ? 'var(--red)'
                      : 'var(--green)',
              }}
            >
              {notice.text}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={localStyles.rowsTable}>
              <div style={localStyles.th}>
                <span>{t('transfer.colSupply')}</span>
                <span style={{ textAlign: 'center' }}>{t('transfer.colQty')}</span>
                <span style={{ textAlign: 'right' }}>{t('transfer.colUnit')}</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <div style={localStyles.empty}>{t('transfer.empty')}</div>
              ) : (
                rows.map((r, i) => (
                  <div
                    key={r.key}
                    style={{
                      ...localStyles.tr,
                      ...(i === rows.length - 1 ? localStyles.trLast : null),
                    }}
                  >
                    <span>{r.supplyName}</span>
                    <span style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={localStyles.qtyControls}>
                        <button
                          type="button"
                          style={localStyles.qtyBtn}
                          onClick={() => setQty(r.key, -1)}
                          aria-label="−"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={r.quantity}
                          onChange={(e) => setQty(r.key, 'set', Number(e.target.value))}
                          style={localStyles.qtyVal}
                        />
                        <button
                          type="button"
                          style={localStyles.qtyBtn}
                          onClick={() => setQty(r.key, 1)}
                          aria-label="+"
                        >
                          +
                        </button>
                      </span>
                    </span>
                    <span style={{ textAlign: 'right', color: 'var(--text2)' }}>
                      {r.unit || '—'}
                    </span>
                    <button
                      type="button"
                      style={localStyles.removeBtn}
                      onClick={() => removeRow(r.key)}
                      aria-label={t('transfer.removeRow')}
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {error && <div style={hubStyles.errBanner}>{error}</div>}
        </div>

        <div style={hubStyles.actions}>
          <button type="button" style={hubStyles.cancelBtn} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={hubStyles.primaryBtn}
            onClick={submit}
            disabled={
              submitMutation.isPending ||
              rows.length === 0 ||
              !fromId ||
              !toId ||
              fromId === toId
            }
          >
            {submitMutation.isPending && <Spinner size={12} />}
            {t('transfer.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
