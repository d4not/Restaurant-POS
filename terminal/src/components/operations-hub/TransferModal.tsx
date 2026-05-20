import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listStorages, type Storage } from '../../api/storages';
import { createTransfer, type CreateTransferInput } from '../../api/transfers';
import { ApiError } from '../../api/client';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';
import { IconTrash } from './HubIcons';
import { SupplyScanPicker, type SupplyPicked } from './SupplyScanPicker';
import {
  loadTransferDefaults,
  saveTransferDefaults,
} from '../../utils/transferDefaults';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
}

interface ScannedRow {
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

  const storagesQuery = useQuery<Storage[]>({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    enabled: open,
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: (input: CreateTransferInput) => createTransfer(input),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      // Remember this pair so the next open of the modal prefills the same
      // direction — most operators repeat the same flow (e.g. Warehouse → Bar).
      void saveTransferDefaults({
        fromId: variables.from_storage_id,
        toId: variables.to_storage_id,
      });
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
    setFromId('');
    setToId('');
  }, [open]);

  // After the storage list loads, prefill from saved defaults — but only if
  // both saved IDs are still active storages. If one was deactivated since
  // the last transfer we fall back to "—" rather than silently picking a
  // wrong location.
  const storagesData = storagesQuery.data;
  useEffect(() => {
    if (!open || !storagesData) return;
    let cancelled = false;
    (async () => {
      const defaults = await loadTransferDefaults();
      if (cancelled || !defaults) return;
      const ids = new Set(storagesData.map((s) => s.id));
      setFromId((cur) => (cur === '' && ids.has(defaults.fromId) ? defaults.fromId : cur));
      setToId((cur) =>
        cur === '' && ids.has(defaults.toId) && defaults.toId !== defaults.fromId
          ? defaults.toId
          : cur,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, storagesData]);

  function addSupply(s: SupplyPicked) {
    setRows((prev) => {
      const existing = prev.find((r) => r.supplyId === s.id);
      if (existing) {
        return prev.map((r) =>
          r.supplyId === s.id ? { ...r, quantity: r.quantity + 1 } : r,
        );
      }
      return [
        ...prev,
        {
          key: `${s.id}-${Date.now()}`,
          supplyId: s.id,
          supplyName: s.name,
          unit: s.unit,
          quantity: 1,
        },
      ];
    });
  }

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

  // ESC closes the modal — the picker swallows Escape only when it has a
  // value to clear, so the parent listener still fires for plain ESC.
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

  const storagesPicked = Boolean(fromId && toId && fromId !== toId);
  const disabledReason = !fromId || !toId
    ? t('transfer.pickStoragesFirst')
    : fromId === toId
      ? t('transfer.sameStorage')
      : undefined;

  const hideIds = useMemo(
    () => new Set(rows.map((r) => r.supplyId)),
    [rows],
  );

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

          <SupplyScanPicker
            active={open}
            enabled={storagesPicked}
            disabledReason={disabledReason}
            onPick={addSupply}
            hideIds={hideIds}
          />
          <div style={hubStyles.hint}>{t('supplyPicker.hint')}</div>

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
