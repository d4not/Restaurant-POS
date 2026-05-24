// Supply · Cascade resolver — the heavy modal launched from SupplyDeleteModal
// when the supply has at least one RecipeItem reference. Lets the operator
// decide, per recipe line, whether to:
//
//   replace      → swap the supply in this line (optionally adjust quantity)
//   remove_line  → drop this recipe line entirely (recipe survives)
//   remove_owner → soft-delete the parent Product (or deactivate the variant)
//
// Each row carries its own resolution state. Filters (search + active only)
// and select-all let the operator apply the same resolution to bulk
// selections without clicking through every row. The footer's "Resolver"
// button POSTs the plan to /supplies/:id/resolve-dependencies, which runs
// the whole thing in a single transaction (see service: every change rolls
// back together if anything fails).
//
// The Modifier / Product / ProductModification soft references are nulled
// automatically by the backend — the modal doesn't surface them because
// they don't need a decision.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';
import { api, ApiError } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { IconClose } from '../../Icons';

// ─── Types ──────────────────────────────────────────────────────────────────

type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
type Action = 'replace' | 'remove_line' | 'remove_owner';

interface ConsumerRow {
  recipe_item_id: string;
  recipe_id: string;
  product_id: string;
  product_name: string;
  product_type: ProductType;
  product_active: boolean;
  variant_id: string | null;
  variant_name: string | null;
  variant_active: boolean | null;
  quantity: string;
  unit: string;
  waste_pct: string;
}

interface SupplyPickerRow {
  id: string;
  name: string;
  base_unit: string;
  category?: { id: string; name: string } | null;
}

interface Resolution {
  action: Action;
  replacement_supply_id?: string;
  new_quantity?: string; // text — parsed on submit
}

interface CascadeResultData {
  replaced: number;
  removed_lines: number;
  removed_owners: number;
  modifier_refs_nulled: number;
  product_refs_nulled: number;
  product_modification_refs_nulled: number;
  supply_soft_deleted: boolean;
  skipped_recipe_items: number;
}

interface Props {
  supplyId: string;
  supplyName: string;
  onClose: () => void;
  onResolved: (msg: string) => void;
  onError: (msg: string) => void;
}

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function fetchConsumers(supplyId: string): Promise<ConsumerRow[]> {
  const res = await api.get<{ items: ConsumerRow[] }>(
    `/supplies/${supplyId}/consuming-products`,
  );
  return res.items;
}

// Replacement picker source — every live supply except the one we're
// resolving. Paginates internally because some catalogs have hundreds.
async function fetchAllLiveSupplies(excludeId: string): Promise<SupplyPickerRow[]> {
  const out: SupplyPickerRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    sp.set('active', 'true');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyPickerRow>>(
      `/supplies?${sp.toString()}`,
    );
    for (const s of page.items) {
      if (s.id !== excludeId) out.push(s);
    }
    cursor = page.nextCursor;
    if (out.length >= 2000) break;
  } while (cursor);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ─── Display helpers ────────────────────────────────────────────────────────

function typeKey(type: ProductType): TranslationKey {
  return `admin.supplyInfo.consumers.type.${type}` as TranslationKey;
}

function actionKey(action: Action): TranslationKey {
  return `admin.supplyCascade.action.${action}` as TranslationKey;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

function formatQty(quantity: string, unit: string): string {
  return `${new Decimal(quantity).toDecimalPlaces(3).toString()} ${unit.toLowerCase()}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyCascadeModal({
  supplyId,
  supplyName,
  onClose,
  onResolved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Esc closes the modal — capture so AdminViewShell doesn't also pop a level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const consumersQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'consumers'],
    queryFn: () => fetchConsumers(supplyId),
    staleTime: 0,
  });

  const suppliesQuery = useQuery({
    queryKey: ['admin', 'supplies', 'replacementPicker', supplyId],
    queryFn: () => fetchAllLiveSupplies(supplyId),
    staleTime: 60_000,
  });

  // Per-row resolution state. We seed it lazily as the operator picks an
  // action, so unanswered rows stay distinguishable from "no resolution".
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  // Bulk selection — only the recipe_item_id; the action menu drives the
  // resolution itself.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // Filters
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  // Bulk-apply staging
  const [bulkAction, setBulkAction] = useState<Action | ''>('');
  const [bulkReplacementId, setBulkReplacementId] = useState<string>('');
  const [bulkQty, setBulkQty] = useState<string>('');

  const rows = consumersQuery.data ?? [];

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const productInactive =
        !r.product_active || (r.variant_id !== null && r.variant_active === false);
      if (activeOnly && productInactive) return false;
      if (q) {
        const hay = `${r.product_name} ${r.variant_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, activeOnly]);

  const allFilteredSelected =
    filteredRows.length > 0 &&
    filteredRows.every((r) => selection.has(r.recipe_item_id));

  function toggleSelectAll() {
    setSelection((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filteredRows) next.delete(r.recipe_item_id);
      } else {
        for (const r of filteredRows) next.add(r.recipe_item_id);
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateResolution(id: string, patch: Partial<Resolution> | null) {
    setResolutions((prev) => {
      const next = new Map(prev);
      if (patch === null) {
        next.delete(id);
        return next;
      }
      const existing = next.get(id) ?? { action: 'replace' };
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }

  function applyBulk() {
    if (!bulkAction || selection.size === 0) return;
    setResolutions((prev) => {
      const next = new Map(prev);
      for (const id of selection) {
        const patch: Resolution = { action: bulkAction };
        if (bulkAction === 'replace') {
          if (bulkReplacementId) patch.replacement_supply_id = bulkReplacementId;
          if (bulkQty.trim()) patch.new_quantity = bulkQty.trim();
        }
        next.set(id, patch);
      }
      return next;
    });
    // Clear the bulk staging so the operator sees their change land instead
    // of leaving the staging fields populated and confusing.
    setBulkAction('');
    setBulkReplacementId('');
    setBulkQty('');
    setSelection(new Set());
  }

  function clearResolution(id: string) {
    updateResolution(id, null);
  }

  // ─── Submit ─────────────────────────────────────────────────────────────

  const submitMut = useMutation({
    mutationFn: async () => {
      const payload = {
        soft_delete: true,
        resolutions: Array.from(resolutions.entries())
          .map(([recipe_item_id, r]) => {
            const out: {
              recipe_item_id: string;
              action: Action;
              replacement_supply_id?: string;
              new_quantity?: number;
            } = { recipe_item_id, action: r.action };
            if (r.action === 'replace') {
              if (!r.replacement_supply_id) return null;
              out.replacement_supply_id = r.replacement_supply_id;
              if (r.new_quantity && r.new_quantity.trim()) {
                const n = Number(r.new_quantity);
                if (Number.isFinite(n) && n > 0) out.new_quantity = n;
              }
            }
            return out;
          })
          .filter((r): r is NonNullable<typeof r> => r !== null),
      };
      return api.post<CascadeResultData>(
        `/supplies/${supplyId}/resolve-dependencies`,
        payload,
      );
    },
    onSuccess: (data) => {
      const msg = interpolate(t('admin.supplyCascade.success'), {
        replaced: data.replaced,
        removed: data.removed_lines + data.removed_owners,
      });
      onResolved(msg);
      queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.supplyCascade.failed');
      onError(msg);
    },
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  // Count what's resolved and detect incomplete 'replace' entries (action
  // chosen but no replacement picked).
  let resolvedCount = 0;
  let incompleteReplaces = 0;
  for (const r of resolutions.values()) {
    resolvedCount += 1;
    if (r.action === 'replace' && !r.replacement_supply_id) {
      incompleteReplaces += 1;
    }
  }
  const unresolvedCount = rows.length - resolvedCount;
  const canSubmit =
    resolvedCount > 0 && incompleteReplaces === 0 && !submitMut.isPending;

  // ─── Render ─────────────────────────────────────────────────────────────

  const loading = consumersQuery.isLoading || suppliesQuery.isLoading;
  const replacementOptions = suppliesQuery.data ?? [];

  return (
    <div style={scrim} onClick={onClose}>
      <div
        style={card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supply-cascade-title"
      >
        {/* Head */}
        <header style={head}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="supply-cascade-title" style={title}>
              {t('admin.supplyCascade.title')}
            </h2>
            <p style={subtitle}>{supplyName}</p>
            <p style={lead}>
              {interpolate(t('admin.supplyCascade.lead'), {
                count: rows.length,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeBtn}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </header>

        {/* Toolbar */}
        <div style={toolbar}>
          <input
            type="text"
            placeholder={t('admin.supplyCascade.filter.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
          />
          <label style={toggleLabel}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <span>{t('admin.supplyCascade.filter.activeOnly')}</span>
          </label>
        </div>

        {/* Bulk-apply bar — only visible when something is selected */}
        {selection.size > 0 && (
          <div style={bulkBar}>
            <span style={bulkLabel}>
              {interpolate(t('admin.supplyCascade.bulk.applyTo'), {
                count: selection.size,
              })}
            </span>
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value as Action | '')}
              style={bulkSelect}
            >
              <option value="">{t('admin.supplyCascade.bulk.pickAction')}</option>
              <option value="replace">{t(actionKey('replace'))}</option>
              <option value="remove_line">{t(actionKey('remove_line'))}</option>
              <option value="remove_owner">{t(actionKey('remove_owner'))}</option>
            </select>
            {bulkAction === 'replace' && (
              <>
                <select
                  value={bulkReplacementId}
                  onChange={(e) => setBulkReplacementId(e.target.value)}
                  style={{ ...bulkSelect, minWidth: 200 }}
                >
                  <option value="">
                    {t('admin.supplyCascade.bulk.pickReplacement')}
                  </option>
                  {replacementOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  placeholder={t('admin.supplyCascade.bulk.qtyPlaceholder')}
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value)}
                  style={bulkQtyInput}
                />
              </>
            )}
            <button
              type="button"
              style={bulkBtn}
              onClick={applyBulk}
              disabled={!bulkAction || (bulkAction === 'replace' && !bulkReplacementId)}
            >
              {t('admin.supplyCascade.bulk.apply')}
            </button>
            <button
              type="button"
              style={bulkBtnGhost}
              onClick={() => setSelection(new Set())}
            >
              {t('admin.supplyCascade.bulk.clear')}
            </button>
          </div>
        )}

        {/* Body */}
        <div style={body}>
          {loading && (
            <div style={loaderWrap}>
              <Spinner />
            </div>
          )}

          {consumersQuery.error && (
            <p style={errorBanner}>{t('admin.supplyCascade.loadFailed')}</p>
          )}

          {!loading && !consumersQuery.error && filteredRows.length === 0 && (
            <p style={emptyHint}>
              {rows.length === 0
                ? t('admin.supplyCascade.emptyNoConsumers')
                : t('admin.supplyCascade.emptyFiltered')}
            </p>
          )}

          {!loading && filteredRows.length > 0 && (
            <div style={tableShell}>
              <div style={tableHead}>
                <span style={headCheck}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    aria-label={t('admin.supplyCascade.selectAll')}
                  />
                </span>
                <span>{t('admin.supplyCascade.col.product')}</span>
                <span>{t('admin.supplyCascade.col.action')}</span>
                <span>{t('admin.supplyCascade.col.detail')}</span>
              </div>

              {filteredRows.map((row) => {
                const inactive =
                  !row.product_active ||
                  (row.variant_id !== null && row.variant_active === false);
                const res = resolutions.get(row.recipe_item_id);
                const isSelected = selection.has(row.recipe_item_id);
                const ownerLabelKey: TranslationKey = row.variant_id
                  ? 'admin.supplyCascade.action.remove_owner_variant'
                  : 'admin.supplyCascade.action.remove_owner_product';
                return (
                  <div
                    key={row.recipe_item_id}
                    style={{
                      ...tableRow,
                      ...(inactive ? rowInactive : {}),
                      ...(res ? rowResolved : {}),
                    }}
                  >
                    <span style={cellCheck}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row.recipe_item_id)}
                      />
                    </span>
                    <span style={productCell}>
                      <span style={productNameStyle}>{row.product_name}</span>
                      <span style={productMetaRow}>
                        <span style={productType}>{t(typeKey(row.product_type))}</span>
                        {row.variant_name && (
                          <span style={variantBadge}>{row.variant_name}</span>
                        )}
                        {inactive && (
                          <span style={inactiveBadge}>
                            {t('admin.supplyCascade.inactive')}
                          </span>
                        )}
                      </span>
                      <span style={lineQtyStyle}>
                        {interpolate(t('admin.supplyCascade.lineQty'), {
                          qty: formatQty(row.quantity, row.unit),
                        })}
                      </span>
                    </span>
                    <span style={actionCell}>
                      <select
                        value={res?.action ?? ''}
                        onChange={(e) => {
                          const v = e.target.value as Action | '';
                          if (v === '') clearResolution(row.recipe_item_id);
                          else updateResolution(row.recipe_item_id, { action: v });
                        }}
                        style={actionSelect}
                      >
                        <option value="">
                          {t('admin.supplyCascade.action.unset')}
                        </option>
                        <option value="replace">{t(actionKey('replace'))}</option>
                        <option value="remove_line">{t(actionKey('remove_line'))}</option>
                        <option value="remove_owner">{t(ownerLabelKey)}</option>
                      </select>
                    </span>
                    <span style={detailCell}>
                      {res?.action === 'replace' && (
                        <div style={replaceDetailRow}>
                          <select
                            value={res.replacement_supply_id ?? ''}
                            onChange={(e) =>
                              updateResolution(row.recipe_item_id, {
                                replacement_supply_id: e.target.value || undefined,
                              })
                            }
                            style={replacementSelect}
                          >
                            <option value="">
                              {t('admin.supplyCascade.bulk.pickReplacement')}
                            </option>
                            {replacementOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <div style={qtyInputWrap}>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min={0}
                              placeholder={row.quantity}
                              value={res.new_quantity ?? ''}
                              onChange={(e) =>
                                updateResolution(row.recipe_item_id, {
                                  new_quantity: e.target.value,
                                })
                              }
                              style={qtyInput}
                            />
                            <span style={qtyUnit}>{row.unit.toLowerCase()}</span>
                          </div>
                        </div>
                      )}
                      {res?.action === 'remove_line' && (
                        <span style={detailHint}>
                          {t('admin.supplyCascade.detail.removeLine')}
                        </span>
                      )}
                      {res?.action === 'remove_owner' && (
                        <span style={detailHint}>
                          {t(
                            row.variant_id
                              ? 'admin.supplyCascade.detail.removeOwnerVariant'
                              : 'admin.supplyCascade.detail.removeOwnerProduct',
                          )}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={footer}>
          <div style={footerStats}>
            {resolvedCount > 0 && (
              <span style={footerStatOk}>
                {interpolate(t('admin.supplyCascade.footer.resolved'), {
                  count: resolvedCount,
                })}
              </span>
            )}
            {unresolvedCount > 0 && (
              <span style={footerStatWarn}>
                {interpolate(t('admin.supplyCascade.footer.unresolved'), {
                  count: unresolvedCount,
                })}
              </span>
            )}
            {incompleteReplaces > 0 && (
              <span style={footerStatErr}>
                {interpolate(t('admin.supplyCascade.footer.incomplete'), {
                  count: incompleteReplaces,
                })}
              </span>
            )}
          </div>
          <div style={footerActions}>
            <button
              type="button"
              style={btnGhost}
              onClick={onClose}
              disabled={submitMut.isPending}
            >
              {t('admin.supplyCascade.cancel')}
            </button>
            <button
              type="button"
              style={canSubmit ? btnPrimary : btnPrimaryDisabled}
              onClick={() => canSubmit && submitMut.mutate()}
              disabled={!canSubmit}
            >
              {submitMut.isPending ? (
                <>
                  <Spinner size={14} />
                  <span>{t('admin.supplyCascade.submitting')}</span>
                </>
              ) : (
                <span>
                  {interpolate(t('admin.supplyCascade.confirm'), {
                    count: resolvedCount,
                  })}
                </span>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.46)',
  zIndex: 260,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const card: CSSProperties = {
  width: 'min(1100px, 100%)',
  maxHeight: 'min(94vh, 820px)',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 24px 60px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.10)',
  overflow: 'hidden',
};

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '20px 26px 14px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const title: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
  lineHeight: 1.2,
};

const subtitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: '4px 0 0',
  fontWeight: 500,
};

const lead: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: '8px 0 0',
  lineHeight: 1.45,
};

const closeBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const toolbar: CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: '12px 26px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const searchInput: CSSProperties = {
  flex: 1,
  minWidth: 240,
  height: 36,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const toggleLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--text2)',
  cursor: 'pointer',
};

const bulkBar: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: '12px 26px',
  borderBottom: '1px solid var(--border)',
  background: 'rgba(201,164,92,0.08)',
};

const bulkLabel: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  fontWeight: 600,
  letterSpacing: '0.02em',
};

const bulkSelect: CSSProperties = {
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 12,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  minWidth: 160,
};

const bulkQtyInput: CSSProperties = {
  height: 34,
  width: 110,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
};

const bulkBtn: CSSProperties = {
  height: 34,
  padding: '0 16px',
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const bulkBtnGhost: CSSProperties = {
  height: 34,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '16px 26px 20px',
};

const tableShell: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  overflow: 'hidden',
};

const COLS = '36px minmax(260px, 2fr) 170px minmax(220px, 2.2fr)';

const tableHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 12,
  padding: '10px 14px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
};

const headCheck: CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 12,
  alignItems: 'center',
  padding: '12px 14px',
  borderTop: '1px solid var(--border)',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 52,
};

const rowInactive: CSSProperties = {
  opacity: 0.65,
};

const rowResolved: CSSProperties = {
  background: 'rgba(74,140,92,0.04)',
};

const cellCheck: CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
};

const productCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};

const productNameStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
};

const productMetaRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const productType: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const variantBadge: CSSProperties = {
  fontSize: 10,
  color: 'var(--text2)',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
};

const inactiveBadge: CSSProperties = {
  fontSize: 9,
  color: 'var(--text2)',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'rgba(168,152,136,0.16)',
  border: '1px solid rgba(168,152,136,0.36)',
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const lineQtyStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
  marginTop: 2,
};

const actionCell: CSSProperties = {
  minWidth: 0,
};

const actionSelect: CSSProperties = {
  width: '100%',
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 12,
  color: 'var(--text1)',
  fontFamily: 'inherit',
};

const detailCell: CSSProperties = {
  minWidth: 0,
};

const replaceDetailRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const replacementSelect: CSSProperties = {
  flex: 1,
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 12,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  minWidth: 0,
};

const qtyInputWrap: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
};

const qtyInput: CSSProperties = {
  width: 96,
  height: 34,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 36px 0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const qtyUnit: CSSProperties = {
  position: 'absolute',
  right: 10,
  fontSize: 11,
  color: 'var(--text3)',
  pointerEvents: 'none',
};

const detailHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  fontStyle: 'italic',
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  padding: '14px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  margin: 0,
};

const errorBanner: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
  margin: 0,
};

const loaderWrap: CSSProperties = {
  padding: 32,
  display: 'flex',
  justifyContent: 'center',
};

const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  padding: '14px 26px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg2)',
  flexShrink: 0,
};

const footerStats: CSSProperties = {
  display: 'inline-flex',
  gap: 14,
  flexWrap: 'wrap',
  fontSize: 12,
};

const footerStatOk: CSSProperties = {
  color: 'var(--green)',
  fontWeight: 600,
};

const footerStatWarn: CSSProperties = {
  color: 'var(--text3)',
};

const footerStatErr: CSSProperties = {
  color: 'var(--red)',
  fontWeight: 600,
};

const footerActions: CSSProperties = {
  display: 'inline-flex',
  gap: 10,
};

const btnGhost: CSSProperties = {
  height: 40,
  padding: '0 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPrimary: CSSProperties = {
  height: 40,
  padding: '0 22px',
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 200,
};

const btnPrimaryDisabled: CSSProperties = {
  ...btnPrimary,
  opacity: 0.5,
  cursor: 'not-allowed',
};
