// Admin-grade transfer: pick source + destination, see low-stock suggestions
// for the destination, and assemble many lines in one go. We reuse the
// existing SupplyScanPicker for ad-hoc additions and the createTransfer
// endpoint (which already accepts an items[] payload) — the differentiator
// vs the cashier modal is the suggestions panel + per-line availability cap
// so admins can't over-transfer.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import {
  fetchStorageStocks,
  listStorages,
  type Storage,
  type StorageStockRow,
} from '../../../api/storages';
import { createTransfer, type CreateTransferInput } from '../../../api/transfers';
import { fetchLowStockAlerts, type LowStockAlertRow } from '../../../api/alerts';
import { ApiError } from '../../../api/client';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { Spinner } from '../../Spinner';
import { SupplyScanPicker, type SupplyPicked } from '../../operations-hub/SupplyScanPicker';
import { IconTrash } from '../../operations-hub/HubIcons';
import {
  loadTransferDefaults,
  saveTransferDefaults,
} from '../../../utils/transferDefaults';

interface MultiTransferViewProps {
  onBack: () => void;
}

interface Line {
  key: string;
  supplyId: string;
  supplyName: string;
  unit: string;
  quantity: number;
}

const COLS = '1fr 140px 160px 36px';

export function MultiTransferView({ onBack }: MultiTransferViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Storages dropdown source. Active filter is the same one the cashier
  // TransferModal uses — keeps source and destination dropdowns in parity.
  const storagesQuery = useQuery({
    queryKey: ['storages', { active: true }],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });
  const storages = storagesQuery.data ?? [];

  // Source-stock lookup: lets us cap line quantities at what the source
  // actually holds. Disabled until a source is picked so the network call
  // doesn't fire on every render.
  const sourceStocksQuery = useQuery({
    queryKey: ['storage-stocks', fromId],
    queryFn: () => fetchStorageStocks(fromId),
    enabled: Boolean(fromId),
    staleTime: 30_000,
  });
  const sourceStocks = sourceStocksQuery.data ?? [];

  // Low-stock alerts at the destination — the "we need this here" half of
  // the suggestion. We then cross-reference with sourceStocks to figure out
  // whether the source can satisfy the shortfall.
  const lowStockQuery = useQuery({
    queryKey: ['low-stock', toId],
    queryFn: () => fetchLowStockAlerts({ storage_id: toId }),
    enabled: Boolean(toId),
    staleTime: 30_000,
  });
  const lowStock = lowStockQuery.data ?? [];

  const sourceStockBySupply = useMemo(() => {
    const m = new Map<string, StorageStockRow>();
    for (const s of sourceStocks) m.set(s.supply_id, s);
    return m;
  }, [sourceStocks]);

  // Build the suggestions list once both stocks are loaded. A suggestion is
  // "destination is below threshold AND source has > 0 of this supply".
  // The amount we propose is the shortfall, capped to whatever the source
  // can actually spare.
  const suggestions = useMemo(() => {
    if (!fromId || !toId) return [];
    const inLines = new Set(lines.map((l) => l.supplyId));
    return lowStock
      .map((alert) => {
        const srcStock = sourceStockBySupply.get(alert.supply_id);
        if (!srcStock) return null;
        const available = new Decimal(srcStock.quantity);
        if (available.lte(0)) return null;
        const shortfall = new Decimal(alert.shortfall);
        const propose = Decimal.min(available, shortfall.gt(0) ? shortfall : new Decimal(1));
        return {
          alert,
          available: available.toString(),
          propose: propose.toFixed(4).replace(/\.?0+$/, ''),
          unit: srcStock.supply.base_unit ?? alert.base_unit,
          alreadyInLines: inLines.has(alert.supply_id),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [lowStock, sourceStockBySupply, fromId, toId, lines]);

  // Clear status banners whenever the operator changes the form — they're
  // momentary, not sticky like a per-row error.
  useEffect(() => {
    setErrorBanner(null);
    setSuccessBanner(null);
  }, [fromId, toId, lines.length]);

  // Prefill the storage pickers from the last-used pair once the storage
  // list arrives. Only fills empty fields and only if the saved IDs still
  // refer to active storages — keeps the form honest if an operator
  // deactivates a storage between transfers.
  const storagesLoaded = Boolean(storagesQuery.data);
  useEffect(() => {
    if (!storagesLoaded) return;
    let cancelled = false;
    (async () => {
      const defaults = await loadTransferDefaults();
      if (cancelled || !defaults) return;
      const ids = new Set((storagesQuery.data ?? []).map((s) => s.id));
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
    // We intentionally only depend on `storagesLoaded` (not the array
    // reference) so the effect runs once after the list arrives, not on every
    // refetch tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagesLoaded]);

  const mutation = useMutation({
    mutationFn: (input: CreateTransferInput) => createTransfer(input),
    onSuccess: (_data, variables) => {
      setSuccessBanner(t('admin.transferAdv.success'));
      setLines([]);
      // Remember this direction so the next visit prefills the same pair.
      // Shared with the cashier modal — both views read the same key.
      void saveTransferDefaults({
        fromId: variables.from_storage_id,
        toId: variables.to_storage_id,
      });
      // Invalidate so the next visit to either view sees fresh stock.
      queryClient.invalidateQueries({ queryKey: ['storage-stocks'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : t('common.error');
      setErrorBanner(msg);
    },
  });

  function addLineFromSupply(supply: SupplyPicked) {
    setLines((prev) => {
      if (prev.some((l) => l.supplyId === supply.id)) return prev;
      return [
        ...prev,
        {
          key: `${supply.id}-${Date.now()}`,
          supplyId: supply.id,
          supplyName: supply.name,
          unit: supply.unit,
          quantity: 1,
        },
      ];
    });
  }

  function addLineFromSuggestion(s: (typeof suggestions)[number]) {
    if (s.alreadyInLines) return;
    setLines((prev) => [
      ...prev,
      {
        key: `${s.alert.supply_id}-${Date.now()}`,
        supplyId: s.alert.supply_id,
        supplyName: s.alert.supply_name,
        unit: s.unit,
        quantity: Number(s.propose) || 1,
      },
    ]);
  }

  function updateLineQty(key: string, qty: number) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function submit() {
    setErrorBanner(null);
    if (!fromId || !toId) {
      setErrorBanner(t('admin.transferAdv.errorPickStorages'));
      return;
    }
    if (fromId === toId) {
      setErrorBanner(t('admin.transferAdv.errorSameStorage'));
      return;
    }
    if (lines.length === 0) {
      setErrorBanner(t('admin.transferAdv.errorNoLines'));
      return;
    }
    const items = lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ supply_id: l.supplyId, quantity: l.quantity }));
    if (items.length === 0) {
      setErrorBanner(t('admin.transferAdv.errorNoLines'));
      return;
    }
    mutation.mutate({
      from_storage_id: fromId,
      to_storage_id: toId,
      date: new Date().toISOString(),
      items,
    });
  }

  const hideIds = useMemo(() => new Set(lines.map((l) => l.supplyId)), [lines]);
  const swapStorages = () => {
    setFromId(toId);
    setToId(fromId);
  };

  return (
    <AdminViewShell
      titleKey="admin.transferAdv.title"
      subtitleKey="admin.transferAdv.subtitle"
      onBack={onBack}
    >
      {/* ─── Storage pickers ────────────────────────────────────────────── */}
      <div style={storageRow}>
        <div style={adminStyles.filterField}>
          <label htmlFor="from-storage" style={adminStyles.filterLabel}>
            {t('admin.transferAdv.from')}
          </label>
          <StoragePicker
            id="from-storage"
            value={fromId}
            storages={storages}
            disabledId={toId}
            onChange={setFromId}
          />
        </div>
        <button
          type="button"
          style={swapBtn}
          onClick={swapStorages}
          aria-label="swap"
          disabled={!fromId || !toId}
        >
          ⇄
        </button>
        <div style={adminStyles.filterField}>
          <label htmlFor="to-storage" style={adminStyles.filterLabel}>
            {t('admin.transferAdv.to')}
          </label>
          <StoragePicker
            id="to-storage"
            value={toId}
            storages={storages}
            disabledId={fromId}
            onChange={setToId}
          />
        </div>
      </div>

      {/* ─── Suggestions ────────────────────────────────────────────────── */}
      <section style={{ marginTop: 22 }}>
        <h3 style={sectionTitle}>{t('admin.transferAdv.suggestionsTitle')}</h3>
        {!fromId || !toId ? (
          <div style={hintCard}>{t('admin.transferAdv.errorPickStorages')}</div>
        ) : lowStockQuery.isLoading || sourceStocksQuery.isLoading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Spinner />
          </div>
        ) : suggestions.length === 0 ? (
          <div style={hintCard}>{t('admin.transferAdv.suggestionsEmpty')}</div>
        ) : (
          <div style={suggestionsGrid}>
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.alert.supply_id}
                suggestion={s}
                onAdd={() => addLineFromSuggestion(s)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Manual picker + lines ──────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h3 style={sectionTitle}>{t('admin.transferAdv.linesTitle')}</h3>
        <div style={{ marginBottom: 10 }}>
          <SupplyScanPicker
            active={true}
            enabled={Boolean(fromId && toId && fromId !== toId)}
            disabledReason={t('admin.transferAdv.errorPickStorages')}
            onPick={addLineFromSupply}
            hideIds={hideIds}
          />
        </div>

        {lines.length === 0 ? (
          <div style={hintCard}>{t('admin.transferAdv.linesEmpty')}</div>
        ) : (
          <div style={tableShell}>
            <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
              <span>{t('admin.transferAdv.col.supply')}</span>
              <span style={alignRight}>{t('admin.transferAdv.col.qty')}</span>
              <span style={alignRight}>{t('admin.transferAdv.col.available')}</span>
              <span />
            </div>
            {lines.map((l) => {
              const srcStock = sourceStockBySupply.get(l.supplyId);
              const available = srcStock ? new Decimal(srcStock.quantity) : new Decimal(0);
              const over = new Decimal(l.quantity).gt(available);
              return (
                <div
                  key={l.key}
                  style={{ ...tableRow, gridTemplateColumns: COLS }}
                >
                  <span style={{ fontWeight: 500 }}>{l.supplyName}</span>
                  <span style={alignRight}>
                    <input
                      type="number"
                      min={0}
                      step={0.0001}
                      style={qtyInput}
                      value={l.quantity}
                      onChange={(e) =>
                        updateLineQty(l.key, Number(e.target.value) || 0)
                      }
                    />
                    {l.unit && (
                      <span style={{ marginLeft: 6, color: 'var(--text3)', fontSize: 12 }}>
                        {l.unit}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      ...alignRight,
                      color: over ? 'var(--red)' : 'var(--text2)',
                      fontWeight: over ? 600 : 500,
                    }}
                  >
                    {available.toFixed(2)} {l.unit}
                    {over && (
                      <div style={{ fontSize: 11, fontStyle: 'italic' }}>
                        {t('admin.transferAdv.overcommit')}
                      </div>
                    )}
                  </span>
                  <button
                    type="button"
                    style={trashBtn}
                    onClick={() => removeLine(l.key)}
                    aria-label="remove"
                  >
                    <IconTrash style={{ fontSize: 14 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Banners ────────────────────────────────────────────────────── */}
      {errorBanner && (
        <div style={{ ...banner, ...bannerErr }}>{errorBanner}</div>
      )}
      {successBanner && (
        <div style={{ ...banner, ...bannerOk }}>{successBanner}</div>
      )}

      {/* ─── Submit ─────────────────────────────────────────────────────── */}
      <div style={submitRow}>
        <button
          type="button"
          style={{
            ...submitBtn,
            opacity: mutation.isPending ? 0.7 : 1,
            cursor: mutation.isPending ? 'wait' : 'pointer',
          }}
          onClick={submit}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? t('admin.transferAdv.submitting')
            : t('admin.transferAdv.submit')}
        </button>
      </div>
    </AdminViewShell>
  );
}

// ─── Storage picker — a styled <select> so it inherits OS keyboard a11y ───
interface StoragePickerProps {
  id: string;
  value: string;
  storages: Storage[];
  /** Storage id to grey out (already used on the other side). */
  disabledId?: string;
  onChange: (id: string) => void;
}
function StoragePicker({ id, value, storages, disabledId, onChange }: StoragePickerProps) {
  return (
    <select
      id={id}
      style={storageSelect}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {storages.map((s) => (
        <option key={s.id} value={s.id} disabled={s.id === disabledId}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

// ─── Suggestion card ────────────────────────────────────────────────────
interface SuggestionCardProps {
  suggestion: {
    alert: LowStockAlertRow;
    available: string;
    propose: string;
    unit: string;
    alreadyInLines: boolean;
  };
  onAdd: () => void;
}
function SuggestionCard({ suggestion: s, onAdd }: SuggestionCardProps) {
  const { t } = useTranslation();
  const shortfall = new Decimal(s.alert.shortfall);
  return (
    <div style={suggestionCard}>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 4 }}>
        <span style={suggestionName}>{s.alert.supply_name}</span>
        <span style={suggestionMeta}>
          {t('admin.transferAdv.shortfall').replace(
            '{amount}',
            `${shortfall.toFixed(2)} ${s.alert.base_unit}`,
          )}
          {' · '}
          {Number(s.available).toFixed(2)} {s.unit}
        </span>
      </div>
      <button
        type="button"
        style={{
          ...adminStyles.pillBtn,
          ...adminStyles.pillBtnActive,
          opacity: s.alreadyInLines ? 0.45 : 1,
          cursor: s.alreadyInLines ? 'default' : 'pointer',
        }}
        disabled={s.alreadyInLines}
        onClick={onAdd}
      >
        {t('admin.transferAdv.use')} {Number(s.propose).toFixed(2)}
      </button>
    </div>
  );
}

// ─── Local styles ───────────────────────────────────────────────────────
const storageRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  gap: 16,
  alignItems: 'flex-end',
};
const swapBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontSize: 16,
  alignSelf: 'flex-end',
};
const storageSelect: React.CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  color: 'var(--text1)',
  padding: '0 10px',
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 220,
};
const sectionTitle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: '0 0 10px',
};
const hintCard: React.CSSProperties = {
  padding: '14px 18px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  color: 'var(--text3)',
  fontSize: 13,
  background: 'var(--bg2)',
};
const suggestionsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 10,
};
const suggestionCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '12px 14px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};
const suggestionName: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text1)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const suggestionMeta: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
};
const tableShell: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
};
const tableHead: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '10px 14px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 600,
};
const tableRow: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '12px 14px',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};
const alignRight: React.CSSProperties = { textAlign: 'right' };
const qtyInput: React.CSSProperties = {
  width: 90,
  height: 32,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text1)',
  padding: '0 8px',
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'right',
};
const trashBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text3)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const banner: React.CSSProperties = {
  marginTop: 16,
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 13,
};
const bannerErr: React.CSSProperties = {
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
};
const bannerOk: React.CSSProperties = {
  background: 'rgba(74,140,92,0.10)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};
const submitRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 22,
};
const submitBtn: React.CSSProperties = {
  padding: '12px 22px',
  borderRadius: 10,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  minHeight: 44,
};
