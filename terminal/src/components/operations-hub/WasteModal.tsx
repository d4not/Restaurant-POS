import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listStorages, type Storage } from '../../api/storages';
import { fetchAllSupplies, type SupplySummary } from '../../api/supplies';
import {
  createWriteOff,
  listWriteOffs,
  WRITE_OFF_REASONS,
  type CreateWriteOffInput,
  type WriteOffReason,
} from '../../api/write-offs';
import { ApiError } from '../../api/client';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';

interface WasteModalProps {
  open: boolean;
  onClose: () => void;
}

// Single pill vocabulary for both Storage and Reason — matches the terminal's
// established active pattern (catBtn, payMethod, tipBtn in pos-terminal-styles).
const pill = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 16px',
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--text1)' : 'var(--border)'}`,
  background: active ? 'var(--text1)' : 'var(--bg)',
  color: active ? '#fff' : 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
  transition: 'background 0.12s, color 0.12s, border-color 0.12s',
});

const localStyles: Record<string, React.CSSProperties> = {
  storageRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  // Combined search + results panel — feels like one cohesive picker
  pickerPanel: {
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg2)',
    overflow: 'hidden',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  searchIcon: {
    width: 18,
    height: 18,
    color: 'var(--text3)',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 15,
    color: 'var(--text1)',
    fontFamily: 'inherit',
    minHeight: 28,
  },
  countPill: {
    fontSize: 11,
    color: 'var(--text3)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'var(--bg)',
    flexShrink: 0,
  },
  // Selected state — single calm tint, one accent (the serif name).
  selectedCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '16px 18px',
    background: 'rgba(201,164,92,0.07)',
  },
  selectedBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
  },
  selectedName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: '4px 0 0',
    lineHeight: 1.2,
  },
  selectedMeta: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  changeBtn: {
    marginLeft: 'auto',
    padding: '0 16px',
    borderRadius: 8,
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  list: {
    maxHeight: 240,
    overflowY: 'auto',
    background: 'var(--bg2)',
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 18px',
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
    background: 'transparent',
    transition: 'background 0.1s',
    minHeight: 52,
  },
  rowName: {
    flex: 1,
    fontSize: 14,
    color: 'var(--text1)',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unitBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--text3)',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '3px 8px',
    flexShrink: 0,
  },
  pickerEmpty: {
    padding: '32px 18px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    fontStyle: 'italic',
  },
  pickerDisabled: {
    padding: '32px 18px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    background: 'var(--bg)',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 140px',
    gap: 12,
    marginBottom: 14,
    marginTop: 14,
  },
  reasonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  historyHead: {
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginTop: 18,
    marginBottom: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  historyHeadCount: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text3)',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '2px 7px',
    letterSpacing: 0,
  },
  historyList: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  historyRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 110px',
    gap: 12,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
  empty: {
    padding: '24px 14px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
};

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={localStyles.searchIcon}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function WasteModal({ open, onClose }: WasteModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [storageId, setStorageId] = useState('');
  const [supplyId, setSupplyId] = useState('');
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<WriteOffReason>('EXPIRED');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [okBanner, setOkBanner] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const quantityInputRef = useRef<HTMLInputElement | null>(null);

  const storagesQuery = useQuery<Storage[]>({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    enabled: open,
    staleTime: 60_000,
  });

  const suppliesQuery = useQuery<SupplySummary[]>({
    queryKey: ['supplies', 'all-active'],
    queryFn: () => fetchAllSupplies(),
    enabled: open,
    staleTime: 60_000,
  });

  // Recent write-off history — capped at 2 so the modal stays compact.
  const historyQuery = useQuery({
    queryKey: ['write-offs', 'recent'],
    queryFn: () => listWriteOffs({ limit: 2 }),
    enabled: open,
    staleTime: 0,
  });

  const submitMutation = useMutation({
    mutationFn: (input: CreateWriteOffInput) => createWriteOff(input),
    onSuccess: async (row) => {
      setOkBanner(t('waste.created').replace('{name}', row.supply.name));
      setError(null);
      setQuantity('');
      setNotes('');
      // Don't clear storage/supply — operator likely wants to log another
      // line in the same pair.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['write-offs'] }),
        queryClient.invalidateQueries({ queryKey: ['supplies'] }),
      ]);
      window.setTimeout(() => setOkBanner(null), 2500);
    },
    onError: (err) => {
      setOkBanner(null);
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT') {
          setError(t('waste.insufficientStock'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('waste.failed'));
      }
    },
  });

  // ESC closes; stops propagation so the parent hub doesn't also process it.
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

  // Reset form on each open. Keep history visible during the open lifetime.
  useEffect(() => {
    if (!open) return;
    setStorageId('');
    setSupplyId('');
    setSearch('');
    setQuantity('');
    setReason('EXPIRED');
    setNotes('');
    setError(null);
    setOkBanner(null);
  }, [open]);

  // Autofocus search input the moment storage is picked → keeps the flow
  // single-handed for tablet operators.
  useEffect(() => {
    if (storageId && !supplyId) {
      searchInputRef.current?.focus();
    }
  }, [storageId, supplyId]);

  const supplies = suppliesQuery.data ?? [];
  const filteredSupplies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplies;
    return supplies.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.barcode ?? '').toLowerCase().includes(q),
    );
  }, [supplies, search]);

  const selectedSupply = useMemo(
    () => supplies.find((s) => s.id === supplyId) ?? null,
    [supplies, supplyId],
  );

  // Barcode-scanner UX: if the typed string is an exact barcode hit, auto-select.
  useEffect(() => {
    const q = search.trim();
    if (!q || q.length < 6) return;
    const hit = supplies.find((s) => s.barcode === q);
    if (hit && hit.id !== supplyId) {
      setSupplyId(hit.id);
      setSearch('');
      // Move focus to quantity for the next action.
      window.setTimeout(() => quantityInputRef.current?.focus(), 0);
    }
  }, [search, supplies, supplyId]);

  function pickSupply(id: string) {
    setSupplyId(id);
    setSearch('');
    window.setTimeout(() => quantityInputRef.current?.focus(), 0);
  }

  function clearSupply() {
    setSupplyId('');
    setSearch('');
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function submit() {
    setError(null);
    if (!storageId) {
      setError(t('waste.pickStorageFirst'));
      return;
    }
    if (!supplyId) {
      setError(t('waste.pickSupplyFirst'));
      return;
    }
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) {
      setError(t('waste.invalidQuantity'));
      return;
    }
    submitMutation.mutate({
      storage_id: storageId,
      supply_id: supplyId,
      quantity: q,
      reason,
      notes: notes.trim() || undefined,
      date: new Date().toISOString(),
    });
  }

  if (!open) return null;

  const storages = storagesQuery.data ?? [];
  const history = historyQuery.data?.items ?? [];

  const matchCountLabel =
    filteredSupplies.length === 1
      ? t('waste.matchCountOne')
      : t('waste.matchCount').replace('{n}', String(filteredSupplies.length));

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div
        style={hubStyles.wideChildModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('waste.title')}</h2>
          <div style={hubStyles.sub}>{t('waste.subtitle')}</div>
        </div>

        <div style={hubStyles.body}>
          {/* Storage as quick-tap chips — one tap, no dropdown */}
          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('waste.storage')}</label>
            <div style={localStyles.storageRow}>
              {storages.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>—</div>
              ) : (
                storages.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setStorageId(s.id)}
                    style={pill(s.id === storageId)}
                  >
                    {s.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Unified supply picker — search + list in one card; replaced by a
              confirmation card once selected. */}
          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('waste.supply')}</label>
            <div style={localStyles.pickerPanel}>
              {selectedSupply ? (
                <div style={localStyles.selectedCard}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={localStyles.selectedBadge}>
                      {t('waste.selected')}
                    </div>
                    <h3 style={localStyles.selectedName}>
                      {selectedSupply.name}
                    </h3>
                    <div style={localStyles.selectedMeta}>
                      {selectedSupply.base_unit}
                      {selectedSupply.content_per_unit && selectedSupply.content_unit
                        ? ` · ${selectedSupply.content_per_unit} ${selectedSupply.content_unit}`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearSupply}
                    style={localStyles.changeBtn}
                  >
                    {t('waste.change')}
                  </button>
                </div>
              ) : !storageId ? (
                <div style={localStyles.pickerDisabled}>
                  {t('waste.storageHint')}
                </div>
              ) : (
                <>
                  <div style={localStyles.searchWrap}>
                    <SearchIcon />
                    <input
                      ref={searchInputRef}
                      style={localStyles.searchInput}
                      placeholder={t('waste.searchPlaceholder')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          filteredSupplies.length > 0
                        ) {
                          e.preventDefault();
                          pickSupply(filteredSupplies[0].id);
                        }
                      }}
                    />
                    {search.trim() && (
                      <span style={localStyles.countPill}>
                        {matchCountLabel}
                      </span>
                    )}
                  </div>
                  <div style={localStyles.list}>
                    {filteredSupplies.length === 0 ? (
                      <div style={localStyles.pickerEmpty}>
                        {search.trim()
                          ? t('waste.noSupplies')
                          : t('waste.searchEmpty')}
                      </div>
                    ) : (
                      filteredSupplies.slice(0, 50).map((s) => (
                        <div
                          key={s.id}
                          onClick={() => pickSupply(s.id)}
                          style={localStyles.listRow}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              pickSupply(s.id);
                            }
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              'rgba(201,164,92,0.07)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span style={localStyles.rowName}>{s.name}</span>
                          <span style={localStyles.unitBadge}>
                            {s.base_unit}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={localStyles.formRow}>
            <div style={hubStyles.field}>
              <label style={hubStyles.label}>{t('waste.quantity')}</label>
              <input
                ref={quantityInputRef}
                style={hubStyles.input}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div style={hubStyles.field}>
              <label style={hubStyles.label}>{t('waste.unit')}</label>
              <input
                style={{
                  ...hubStyles.input,
                  color: selectedSupply ? 'var(--text1)' : 'var(--text3)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
                value={selectedSupply?.base_unit ?? ''}
                placeholder="…"
                readOnly
              />
            </div>
          </div>

          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('waste.reason')}</label>
            <div style={localStyles.reasonRow}>
              {WRITE_OFF_REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setReason(r)}
                  style={pill(r === reason)}
                >
                  {t(`waste.reason.${r}`)}
                </button>
              ))}
            </div>
          </div>

          <div style={hubStyles.field}>
            <label style={hubStyles.label}>{t('waste.notes')}</label>
            <textarea
              style={hubStyles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder={t('waste.notesPlaceholder')}
            />
          </div>

          {okBanner && <div style={hubStyles.okBanner}>{okBanner}</div>}
          {error && <div style={hubStyles.errBanner}>{error}</div>}

          <div style={localStyles.historyHead}>
            <span>{t('waste.recentHistory')}</span>
            {history.length > 0 && (
              <span style={localStyles.historyHeadCount}>{history.length}</span>
            )}
          </div>
          <div style={localStyles.historyList}>
            {history.length === 0 ? (
              <div style={localStyles.empty}>{t('waste.historyEmpty')}</div>
            ) : (
              history.map((row, i) => (
                <div
                  key={row.id}
                  style={{
                    ...localStyles.historyRow,
                    ...(i === history.length - 1
                      ? { borderBottom: 'none' }
                      : null),
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.supply.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {row.storage.name} · {t(`waste.reason.${row.reason}`)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text2)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                    }}
                  >
                    {Number(row.quantity).toLocaleString()} {row.supply.base_unit}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text3)',
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                    }}
                  >
                    {formatDate(row.date)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={hubStyles.actions}>
          <button type="button" style={hubStyles.cancelBtn} onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            style={hubStyles.primaryBtn}
            onClick={submit}
            disabled={
              submitMutation.isPending ||
              !storageId ||
              !supplyId ||
              !quantity
            }
          >
            {submitMutation.isPending && <Spinner size={12} />}
            {t('waste.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
