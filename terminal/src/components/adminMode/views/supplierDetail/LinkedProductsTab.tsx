// Linked Products tab — packagings this supplier ships.
//
// Moved verbatim from the old SuppliersListView drawer's "Packagings" tab so
// the operator's workflow (add a packaging, edit one, toggle is_primary,
// disable/enable) keeps working in the new detail surface. The only changes
// vs the original drawer code:
//   - createPackaging/updatePackaging come from api/packagings.ts now.
//   - Field primitives + button styles come from ./supplierForm.
//   - The query key + pkgCounts invalidation match the existing keys so the
//     parent list view's packaging-count column stays in sync.

import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import {
  createPackaging,
  listPackagings,
  updatePackaging,
  type CreatePackagingInput,
  type PackagingWriteInput,
  type PurchasePackaging,
} from '../../../../api/packagings';
import { searchSupplies, type SupplySearchResult } from '../../../../api/supplies';
import type { Supplier } from '../../../../api/suppliers';
import { useTranslation } from '../../../../i18n';
import { formatMoneyPlain } from '../../../../utils/format';
import { Spinner } from '../../../Spinner';
import {
  FieldDecimal,
  FieldText,
  btnGold,
  btnPrimary,
  btnSecondary,
  fieldLabel,
  fieldStyle,
  formStyle,
  textInputStyle,
} from './supplierForm';

interface Props {
  supplier: Supplier;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

export function LinkedProductsTab({ supplier, onSaved, onError }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pkgQuery = useQuery({
    queryKey: ['admin', 'suppliers', supplier.id, 'packagings'],
    queryFn: () => listPackagings({ supplier_id: supplier.id, limit: 100 }),
    staleTime: 15_000,
  });

  const rows = pkgQuery.data ?? [];

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ['admin', 'suppliers', supplier.id, 'packagings'],
    });
    // Parent list view's packaging-count column reads this key. Regressing
    // it = stale numbers on the row the operator just opened, which is the
    // classic "I just added one and the count didn't bump" bug.
    queryClient.invalidateQueries({
      queryKey: ['admin', 'suppliers', 'pkgCounts'],
    });
  }

  const createMut = useMutation({
    mutationFn: (input: CreatePackagingInput) => createPackaging(input),
    onSuccess: () => {
      onSaved(t('admin.suppliersList.pkg.added'));
      invalidate();
      setAddOpen(false);
    },
    onError: () => onError(t('admin.suppliersList.pkg.saveFailed')),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: PackagingWriteInput;
    }) => updatePackaging(id, input),
    onSuccess: () => {
      onSaved(t('admin.suppliersList.pkg.saved'));
      invalidate();
      setEditingId(null);
    },
    onError: () => onError(t('admin.suppliersList.pkg.saveFailed')),
  });

  return (
    <div style={formStyle}>
      <div style={pkgHeaderRow}>
        <div style={{ minWidth: 0 }}>
          <h4 style={pkgHeading}>{t('admin.supplierDetail.products.heading')}</h4>
          <p style={pkgNote}>{t('admin.supplierDetail.products.note')}</p>
        </div>
        {!addOpen && (
          <button
            type="button"
            style={btnGold}
            onClick={() => setAddOpen(true)}
            disabled={!supplier.active}
            title={
              supplier.active
                ? undefined
                : t('admin.supplierDetail.status.inactive')
            }
          >
            + {t('admin.suppliersList.pkg.add')}
          </button>
        )}
      </div>

      {addOpen && (
        <PackagingEditor
          mode="create"
          supplierId={supplier.id}
          onCancel={() => setAddOpen(false)}
          onSubmit={(payload) =>
            createMut.mutate(payload as CreatePackagingInput)
          }
          submitting={createMut.isPending}
        />
      )}

      {pkgQuery.isLoading && (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      )}

      {!pkgQuery.isLoading && rows.length === 0 && !addOpen && (
        <div style={pkgEmpty}>{t('admin.suppliersList.pkg.empty')}</div>
      )}

      {rows.length > 0 && (
        <div style={pkgList}>
          <div style={pkgListHead}>
            <span>{t('admin.suppliersList.pkg.col.supply')}</span>
            <span>{t('admin.suppliersList.pkg.col.name')}</span>
            <span style={cellNumHead}>
              {t('admin.suppliersList.pkg.col.units')}
            </span>
            <span style={cellNumHead}>
              {t('admin.suppliersList.pkg.col.price')}
            </span>
            <span />
          </div>
          {rows.map((p) =>
            editingId === p.id ? (
              <PackagingEditor
                key={p.id}
                mode="edit"
                supplierId={supplier.id}
                initial={p}
                onCancel={() => setEditingId(null)}
                onSubmit={(payload) =>
                  updateMut.mutate({
                    id: p.id,
                    input: payload as PackagingWriteInput,
                  })
                }
                submitting={updateMut.isPending}
              />
            ) : (
              <PackagingRow
                key={p.id}
                pkg={p}
                onEdit={() => setEditingId(p.id)}
                onMakePrimary={() =>
                  updateMut.mutate({ id: p.id, input: { is_primary: true } })
                }
                onToggleActive={() =>
                  updateMut.mutate({
                    id: p.id,
                    input: { active: !p.active },
                  })
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row (read-only) ──────────────────────────────────────────────────────

function PackagingRow({
  pkg,
  onEdit,
  onMakePrimary,
  onToggleActive,
}: {
  pkg: PurchasePackaging;
  onEdit: () => void;
  onMakePrimary: () => void;
  onToggleActive: () => void;
}) {
  const { t } = useTranslation();
  // The list endpoint joins supplier but not supply, so the row asks for the
  // supply name via a separate cached read. Until it resolves we fall back to
  // an id-tail — keeps the row identifiable without N+1 blocking.
  const fallback = pkg.supply_id ? `…${pkg.supply_id.slice(-6)}` : '—';
  const units = Number(pkg.units_per_package);
  const unitsLabel = Number.isFinite(units)
    ? units % 1 === 0
      ? units.toFixed(0)
      : units.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    : '—';
  const priceLabel = pkg.price_per_package
    ? formatMoneyPlain(pkg.price_per_package)
    : '—';

  return (
    <div
      style={{
        ...pkgRow,
        opacity: pkg.active ? 1 : 0.55,
      }}
    >
      <span style={pkgSupplyCell}>
        {pkg.is_primary && <span style={primaryDot} aria-hidden />}
        <span style={pkgSupplyName}>
          <SupplyName supplyId={pkg.supply_id} fallback={fallback} />
        </span>
      </span>
      <span style={pkgNameCell}>{pkg.name}</span>
      <span style={cellNum}>{unitsLabel}</span>
      <span style={cellNum}>{priceLabel}</span>
      <span style={pkgActionsCell}>
        {!pkg.is_primary && pkg.active && (
          <button type="button" style={pkgChip} onClick={onMakePrimary}>
            {t('admin.suppliersList.pkg.makePrimary')}
          </button>
        )}
        <button type="button" style={pkgChip} onClick={onEdit}>
          {t('admin.suppliersList.pkg.edit')}
        </button>
        <button
          type="button"
          style={pkg.active ? pkgChipDanger : pkgChip}
          onClick={onToggleActive}
        >
          {pkg.active
            ? t('admin.suppliersList.pkg.disable')
            : t('admin.suppliersList.pkg.enable')}
        </button>
      </span>
    </div>
  );
}

function SupplyName({
  supplyId,
  fallback,
}: {
  supplyId: string;
  fallback: string;
}) {
  const query = useQuery({
    queryKey: ['admin', 'supplies', 'byId', supplyId],
    queryFn: () =>
      api.get<{ id: string; name: string }>(`/supplies/${supplyId}`),
    staleTime: 5 * 60_000,
  });
  if (query.data) return <>{query.data.name}</>;
  return (
    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fallback}</span>
  );
}

// ─── Editor (shared by add + edit) ─────────────────────────────────────────

interface PackagingFormState {
  supply_id: string;
  supply_label: string;
  name: string;
  units_per_package: string;
  price_per_package: string;
  is_primary: boolean;
}

interface PackagingEditorProps {
  mode: 'create' | 'edit';
  supplierId: string;
  initial?: PurchasePackaging;
  onSubmit: (payload: CreatePackagingInput | PackagingWriteInput) => void;
  onCancel: () => void;
  submitting: boolean;
}

function PackagingEditor({
  mode,
  supplierId,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: PackagingEditorProps) {
  const { t } = useTranslation();

  const [state, setState] = useState<PackagingFormState>(() => ({
    supply_id: initial?.supply_id ?? '',
    supply_label: '',
    name: initial?.name ?? '',
    units_per_package: initial?.units_per_package
      ? String(initial.units_per_package)
      : '',
    price_per_package: initial?.price_per_package
      ? (Number(initial.price_per_package) / 100).toFixed(2)
      : '',
    is_primary: initial?.is_primary ?? false,
  }));

  // In edit mode we need the supply's real name in the "locked" row. The
  // picker fills supply_label directly when the user picks; this resolves it
  // for an already-saved row that the user is now editing.
  const editingExistingQuery = useQuery({
    queryKey: ['admin', 'supplies', 'byId', state.supply_id],
    queryFn: () =>
      api.get<{ id: string; name: string }>(`/supplies/${state.supply_id}`),
    enabled: mode === 'edit' && !!state.supply_id && !state.supply_label,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (editingExistingQuery.data && !state.supply_label) {
      setState((prev) => ({
        ...prev,
        supply_label: editingExistingQuery.data!.name,
      }));
    }
  }, [editingExistingQuery.data, state.supply_label]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const units = Number(state.units_per_package);
    if (!Number.isFinite(units) || units <= 0) return;
    const priceTrim = state.price_per_package.trim();
    const priceCents =
      priceTrim === '' ? null : Math.round(Number(priceTrim) * 100);
    const baseName = state.name.trim();
    if (!baseName) return;

    if (mode === 'create') {
      if (!state.supply_id) return;
      const payload: CreatePackagingInput = {
        supply_id: state.supply_id,
        supplier_id: supplierId,
        name: baseName,
        units_per_package: units,
        price_per_package: priceCents,
        is_primary: state.is_primary,
      };
      onSubmit(payload);
    } else {
      const payload: PackagingWriteInput = {
        name: baseName,
        units_per_package: units,
        price_per_package: priceCents,
        is_primary: state.is_primary,
      };
      onSubmit(payload);
    }
  }

  return (
    <form onSubmit={submit} style={pkgEditor}>
      <div style={pkgEditorGrid}>
        {mode === 'create' ? (
          <div style={{ ...fieldStyle, gridColumn: 'span 2' }}>
            <span style={fieldLabel}>
              {t('admin.suppliersList.pkg.field.supply')}
            </span>
            <SupplyPicker
              value={state.supply_id}
              label={state.supply_label}
              onChange={(supply) =>
                setState((prev) => ({
                  ...prev,
                  supply_id: supply.id,
                  supply_label: supply.name,
                }))
              }
            />
          </div>
        ) : (
          <div style={{ ...fieldStyle, gridColumn: 'span 2' }}>
            <span style={fieldLabel}>
              {t('admin.suppliersList.pkg.field.supply')}
            </span>
            <div style={lockedSupply}>
              {state.supply_label ||
                editingExistingQuery.data?.name ||
                '—'}
            </div>
          </div>
        )}

        <FieldText
          label={t('admin.suppliersList.pkg.field.name')}
          value={state.name}
          onChange={(v) => setState((prev) => ({ ...prev, name: v }))}
          placeholder={t('admin.suppliersList.pkg.field.namePlaceholder')}
          required
        />
        <FieldDecimal
          label={t('admin.suppliersList.pkg.field.units')}
          value={state.units_per_package}
          onChange={(v) =>
            setState((prev) => ({ ...prev, units_per_package: v }))
          }
          required
          min={0}
          step="0.0001"
        />
        <FieldDecimal
          label={t('admin.suppliersList.pkg.field.price')}
          value={state.price_per_package}
          onChange={(v) =>
            setState((prev) => ({ ...prev, price_per_package: v }))
          }
          min={0}
          step="0.01"
        />
        <label style={{ ...fieldStyle, justifyContent: 'flex-end' }}>
          <span style={fieldLabel}>
            {t('admin.suppliersList.pkg.col.primary')}
          </span>
          <button
            type="button"
            onClick={() =>
              setState((prev) => ({ ...prev, is_primary: !prev.is_primary }))
            }
            style={{
              ...primaryToggle,
              ...(state.is_primary ? primaryToggleOn : {}),
            }}
          >
            {state.is_primary
              ? t('admin.suppliersList.pkg.primary')
              : t('admin.suppliersList.pkg.makePrimary')}
          </button>
        </label>
      </div>

      <div style={pkgEditorFooter}>
        <button type="button" style={btnSecondary} onClick={onCancel}>
          {t('admin.suppliersList.pkg.cancel')}
        </button>
        <span style={{ flex: 1 }} />
        <button type="submit" style={btnPrimary} disabled={submitting}>
          {t('admin.suppliersList.pkg.save')}
        </button>
      </div>
    </form>
  );
}

// Searchable supply picker. Debounced; arrow keys not yet wired (matches the
// original drawer's behavior — typeable + mouse-clickable).
function SupplyPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (supply: { id: string; name: string }) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const debounced = useDebounced(query, 180);

  const search = useQuery({
    queryKey: ['admin', 'supplies', 'search', debounced],
    queryFn: () => searchSupplies(debounced, 10),
    enabled: open && debounced.trim().length > 0,
    staleTime: 30_000,
  });

  return (
    <div style={pickerWrap}>
      <input
        type="text"
        placeholder={
          value ? label : t('admin.suppliersList.pkg.supplyPicker')
        }
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer so click on a result registers first.
          setTimeout(() => setOpen(false), 120);
        }}
        style={textInputStyle}
      />
      {value && !query && <span style={pickerSelected}>{label || '—'}</span>}
      {open && debounced.trim() && (
        <div style={pickerDropdown}>
          {search.isLoading && (
            <div style={pickerLoading}>
              <Spinner size={14} />
            </div>
          )}
          {!search.isLoading && (search.data?.length ?? 0) === 0 && (
            <div style={pickerEmpty}>—</div>
          )}
          {(search.data ?? []).map((s: SupplySearchResult) => (
            <button
              key={s.id}
              type="button"
              style={pickerOption}
              onMouseDown={() => {
                onChange({ id: s.id, name: s.name });
                setQuery('');
                setOpen(false);
              }}
            >
              <span>{s.name}</span>
              {s.content_per_unit && s.content_unit && (
                <span style={pickerOptionHint}>
                  {s.content_per_unit} {s.content_unit.toLowerCase()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t0 = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t0);
  }, [value, ms]);
  return v;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const spinnerWrap: CSSProperties = {
  padding: 28,
  display: 'flex',
  justifyContent: 'center',
};

const pkgHeaderRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
};

const pkgHeading: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const pkgNote: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  marginTop: 4,
  maxWidth: 480,
  lineHeight: 1.45,
};

const pkgList: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg2)',
};

const PKG_COLS = 'minmax(0, 1.2fr) minmax(0, 1.4fr) 100px 110px minmax(220px, auto)';

const pkgListHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: PKG_COLS,
  gap: 12,
  padding: '11px 16px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const pkgRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: PKG_COLS,
  gap: 12,
  padding: '12px 16px',
  borderTop: '1px solid var(--border)',
  alignItems: 'center',
  fontSize: 13,
  minHeight: 56,
};

const pkgSupplyCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const pkgSupplyName: CSSProperties = {
  color: 'var(--text1)',
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pkgNameCell: CSSProperties = {
  color: 'var(--text2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text1)',
};

const cellNumHead: CSSProperties = { textAlign: 'right' };

const pkgActionsCell: CSSProperties = {
  display: 'flex',
  gap: 6,
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
};

const pkgChip: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  minHeight: 32,
};

const pkgChipDanger: CSSProperties = {
  ...pkgChip,
  color: 'var(--red)',
  borderColor: 'rgba(196,80,64,0.25)',
};

const primaryDot: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: 'var(--gold)',
  flexShrink: 0,
};

const pkgEmpty: CSSProperties = {
  border: '1px dashed var(--border)',
  borderRadius: 10,
  padding: '36px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
  background: 'var(--bg2)',
};

const pkgEditor: CSSProperties = {
  border: '1px solid rgba(201,164,92,0.45)',
  borderRadius: 10,
  background: 'rgba(201,164,92,0.05)',
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const pkgEditorGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 14,
};

const pkgEditorFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const lockedSupply: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text2)',
  display: 'flex',
  alignItems: 'center',
};

const pickerWrap: CSSProperties = {
  position: 'relative',
};

const pickerSelected: CSSProperties = {
  position: 'absolute',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 13,
  color: 'var(--text2)',
  pointerEvents: 'none',
};

const pickerDropdown: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 12px 32px rgba(44,36,32,0.16)',
  maxHeight: 240,
  overflowY: 'auto',
  zIndex: 10,
};

const pickerLoading: CSSProperties = {
  padding: 16,
  display: 'flex',
  justifyContent: 'center',
};

const pickerEmpty: CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const pickerOption: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  textAlign: 'left',
  cursor: 'pointer',
};

const pickerOptionHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontVariantNumeric: 'tabular-nums',
};

const primaryToggle: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  color: 'var(--text2)',
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
};

const primaryToggleOn: CSSProperties = {
  background: 'var(--gold)',
  borderColor: 'var(--gold)',
  color: '#2c2420',
};
