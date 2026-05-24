// Admin Mode · Employee Products — CRUD list with inline modal form.
//
// Manages staff pricing overrides: employee meals, discounts on specific
// products or variants. No sub-view routing — create/edit/delete all happen
// via a modal form layered over the list.
//
// Backend touch points
//   GET    /api/v1/employee-products          — paginated list
//   POST   /api/v1/employee-products          — create
//   PATCH  /api/v1/employee-products/:id      — update
//   DELETE /api/v1/employee-products/:id      — delete

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import {
  useEmployeeProductsAdmin,
  useCreateEmployeeProduct,
  useUpdateEmployeeProduct,
  useDeleteEmployeeProduct,
} from '../../../hooks/useEmployeeProductsAdmin';
import type { EmployeeProduct } from '../../../api/employee-products';
import { listProductsAdmin, type PosProduct } from '../../../api/products';
import { formatMoney } from '../../../utils/format';
import {
  productTypeBadgeStyle,
  productTypeLabel,
} from '../../../utils/product-meta';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

interface Props {
  onBack: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

/** Display name: use label if set, else product name + optional variant name. */
function displayName(ep: EmployeeProduct): { main: string; sub: string | null } {
  if (ep.label) {
    const sub = ep.variant
      ? `${ep.product.name} · ${ep.variant.name}`
      : ep.product.name;
    return { main: ep.label, sub };
  }
  return {
    main: ep.product.name,
    sub: ep.variant ? ep.variant.name : null,
  };
}

/** Regular price: prefer variant sell_price, fallback to "—". */
function regularPrice(ep: EmployeeProduct): string {
  if (ep.variant) {
    const n = Number(ep.variant.sell_price);
    if (Number.isFinite(n) && n > 0) return formatMoney(n);
  }
  return '—';
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function EmployeeProductsListView({ onBack }: Props) {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <>
      <EmployeeProductsList
        onBack={onBack}
        onSaved={(text) => setToast({ kind: 'ok', text })}
        onError={(text) => setToast({ kind: 'err', text })}
      />
      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </>
  );
}

/* ── List screen ────────────────────────────────────────────────────────── */

interface ListProps {
  onBack: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function EmployeeProductsList({ onBack, onSaved, onError }: ListProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeProduct | undefined>(undefined);

  const query = useEmployeeProductsAdmin();
  const allRows = query.data?.items ?? [];

  const filteredByStatus = useMemo(() => {
    if (status === 'ALL') return allRows;
    if (status === 'ACTIVE') return allRows.filter((ep) => ep.active);
    return allRows.filter((ep) => !ep.active);
  }, [allRows, status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByStatus;
    return filteredByStatus.filter((ep) => {
      const hay = `${ep.label ?? ''} ${ep.product.name} ${ep.variant?.name ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filteredByStatus, search]);

  const kpis = useMemo(() => {
    const active = allRows.filter((ep) => ep.active).length;
    const inactive = allRows.length - active;
    return { total: allRows.length, active, inactive };
  }, [allRows]);

  const countLabel =
    filtered.length === 1
      ? t('admin.employeeProducts.count.shownOne')
      : interpolate(t('admin.employeeProducts.count.shown'), { count: filtered.length });

  const openCreate = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

  const openEdit = (ep: EmployeeProduct) => {
    setEditing(ep);
    setModalOpen(true);
  };

  return (
    <AdminViewShell
      titleKey="admin.employeeProducts.title"
      subtitleKey="admin.employeeProducts.subtitle"
      onBack={onBack}
      headerActions={
        <span style={headerActions}>
          <span style={countPill} aria-live="polite">
            {countLabel}
          </span>
          <button type="button" style={btnPrimary} onClick={openCreate}>
            {t('admin.employeeProducts.newBtn')}
          </button>
        </span>
      }
    >
      {/* KPI strip */}
      <div style={kpiGrid}>
        <KpiCell
          label={t('admin.employeeProducts.kpi.total')}
          value={String(kpis.total)}
          hint={t('admin.employeeProducts.kpi.totalHint')}
        />
        <KpiCell
          label={t('admin.employeeProducts.kpi.active')}
          value={String(kpis.active)}
          hint={t('admin.employeeProducts.kpi.activeHint')}
        />
        <KpiCell
          label={t('admin.employeeProducts.kpi.inactive')}
          value={String(kpis.inactive)}
          hint={t('admin.employeeProducts.kpi.inactiveHint')}
          muted
        />
      </div>

      {/* Filter toolbar */}
      <div style={filterBar}>
        <label style={{ ...filterField, flex: 1, minWidth: 240 }}>
          <span style={filterLabel}>{t('admin.employeeProducts.filter.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.employeeProducts.filter.searchPlaceholder')}
            style={textInput}
          />
        </label>

        <div style={filterField}>
          <span style={filterLabel}>{t('admin.employeeProducts.col.status')}</span>
          <div style={pillRow}>
            {(['ALL', 'ACTIVE', 'INACTIVE'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{ ...pillBtn, ...(status === s ? pillBtnActive : {}) }}
              >
                {s === 'ALL'
                  ? t('admin.employeeProducts.filter.statusAll')
                  : s === 'ACTIVE'
                    ? t('admin.employeeProducts.filter.statusActive')
                    : t('admin.employeeProducts.filter.statusInactive')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={tableShell}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('admin.employeeProducts.col.name')}</span>
          <span style={cellNumHead}>{t('admin.employeeProducts.col.employeePrice')}</span>
          <span style={cellNumHead}>{t('admin.employeeProducts.col.regularPrice')}</span>
          <span>{t('admin.employeeProducts.col.type')}</span>
          <span>{t('admin.employeeProducts.col.status')}</span>
        </div>

        {query.isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}

        {!query.isLoading && filtered.length === 0 && (
          <div style={emptyState}>
            <p style={emptyTitle}>{t('admin.employeeProducts.empty')}</p>
            <p style={emptyHint}>{t('admin.employeeProducts.emptyHint')}</p>
          </div>
        )}

        {!query.isLoading &&
          filtered.map((row) => {
            const dn = displayName(row);
            const isActive = row.active;

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => openEdit(row)}
                style={{ ...tableRow, gridTemplateColumns: COLS }}
              >
                <span style={nameCell}>
                  <span style={nameMain}>{dn.main}</span>
                  {dn.sub && <span style={nameSub}>{dn.sub}</span>}
                </span>
                <span style={cellNumGold}>{formatMoney(row.employee_price)}</span>
                <span style={cellNumMuted}>{regularPrice(row)}</span>
                <span style={typeCell}>
                  <span style={{ ...typeBadge, ...productTypeBadgeStyle(row.product.type) }}>
                    {productTypeLabel(row.product.type)}
                  </span>
                </span>
                <span>
                  <span
                    style={{
                      ...statusBadge,
                      ...(isActive ? statusBadgeOk : statusBadgeOff),
                    }}
                  >
                    {isActive
                      ? t('admin.employeeProducts.status.active')
                      : t('admin.employeeProducts.status.inactive')}
                  </span>
                </span>
              </button>
            );
          })}
      </div>

      {/* Form modal */}
      <EmployeeProductFormModal
        open={modalOpen}
        item={editing}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
        onError={onError}
      />
    </AdminViewShell>
  );
}

/* ── Form modal ────────────────────────────────────────────────────────── */

interface FormModalProps {
  open: boolean;
  item?: EmployeeProduct;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

interface FormState {
  product_id: string;
  variant_id: string;
  employee_price: string;
  label: string;
  active: boolean;
  display_order: string;
}

const EMPTY_FORM: FormState = {
  product_id: '',
  variant_id: '',
  employee_price: '',
  label: '',
  active: true,
  display_order: '0',
};

function fromItem(ep: EmployeeProduct): FormState {
  return {
    product_id: ep.product_id,
    variant_id: ep.variant_id ?? '',
    employee_price: String(Number(ep.employee_price) / 100),
    label: ep.label ?? '',
    active: ep.active,
    display_order: String(ep.display_order),
  };
}

function EmployeeProductFormModal({ open, item, onClose, onSaved, onError }: FormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!item;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const productsQuery = useQuery({
    queryKey: ['admin', 'products', { includeInactive: false }],
    queryFn: () => listProductsAdmin({ includeInactive: false }),
    staleTime: 30_000,
    enabled: open,
  });

  // Filter out PREPARATIONs — they can't be sold to employees
  const products = useMemo<PosProduct[]>(
    () => (productsQuery.data ?? []).filter((p) => p.type !== 'PREPARATION'),
    [productsQuery.data],
  );

  const createM = useCreateEmployeeProduct();
  const updateM = useUpdateEmployeeProduct();
  const deleteM = useDeleteEmployeeProduct();

  useEffect(() => {
    if (!open) return;
    setForm(item ? fromItem(item) : EMPTY_FORM);
    setErrors({});
    setConfirmDelete(false);
  }, [open, item]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === form.product_id) ?? null,
    [products, form.product_id],
  );

  const variants = useMemo(
    () => (selectedProduct?.variants ?? []).filter((v) => v.active),
    [selectedProduct],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onProductChange = (id: string) => {
    setForm((f) => ({ ...f, product_id: id, variant_id: '' }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.product_id) e.product_id = 'Required';
    const priceNum = Number(form.employee_price);
    if (!form.employee_price.trim() || !Number.isFinite(priceNum) || priceNum < 0) {
      e.employee_price = 'Required';
    }
    const orderNum = Number(form.display_order);
    if (form.display_order.trim() && (!Number.isInteger(orderNum) || orderNum < 0)) {
      e.display_order = 'Must be a non-negative integer';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const employee_price = Math.round(Number(form.employee_price) * 100);
    const display_order = Number(form.display_order) || 0;

    try {
      if (isEdit && item) {
        await updateM.mutateAsync({
          id: item.id,
          input: {
            employee_price,
            label: form.label.trim() || null,
            active: form.active,
            display_order,
          },
        });
        onSaved(t('admin.employeeProducts.saved'));
      } else {
        await createM.mutateAsync({
          product_id: form.product_id,
          variant_id: form.variant_id || null,
          employee_price,
          label: form.label.trim() || null,
          active: form.active,
          display_order,
        });
        onSaved(t('admin.employeeProducts.created'));
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteM.mutateAsync(item.id);
      onSaved(t('admin.employeeProducts.deleted'));
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending || deleteM.isPending;

  if (!open) return null;

  return (
    <div style={modalScrim} onClick={pending ? undefined : onClose}>
      <div
        style={modalBox}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !pending) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div style={modalHeader}>
          <h2 style={modalTitle}>
            {isEdit
              ? t('admin.employeeProducts.form.titleEdit')
              : t('admin.employeeProducts.form.titleNew')}
          </h2>
          <button
            type="button"
            style={modalCloseBtn}
            onClick={onClose}
            disabled={pending}
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={modalBody}>
          {/* Product picker */}
          <div style={fieldWrap}>
            <label style={fieldLabelStyle}>
              {t('admin.employeeProducts.form.product')}
            </label>
            <select
              value={form.product_id}
              onChange={(e) => onProductChange(e.target.value)}
              disabled={isEdit || productsQuery.isLoading}
              style={{
                ...textInput,
                width: '100%',
                ...(errors.product_id ? fieldError : {}),
              }}
            >
              <option value="">
                {productsQuery.isLoading
                  ? t('common.loading')
                  : t('admin.employeeProducts.form.productPlaceholder')}
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({productTypeLabel(p.type)})
                </option>
              ))}
            </select>
            {errors.product_id && <span style={errorText}>{errors.product_id}</span>}
          </div>

          {/* Variant picker */}
          {selectedProduct && variants.length > 0 && (
            <div style={fieldWrap}>
              <label style={fieldLabelStyle}>
                {t('admin.employeeProducts.form.variant')}
              </label>
              <select
                value={form.variant_id}
                onChange={(e) => set('variant_id', e.target.value)}
                disabled={isEdit}
                style={{ ...textInput, width: '100%' }}
              >
                <option value="">{t('admin.employeeProducts.form.variantNone')}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {formatMoney(v.sell_price)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Employee price */}
          <div style={fieldWrap}>
            <label style={fieldLabelStyle}>
              {t('admin.employeeProducts.form.employeePrice')} ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.employee_price}
              onChange={(e) => set('employee_price', e.target.value)}
              placeholder="0.00"
              style={{
                ...textInput,
                width: '100%',
                ...(errors.employee_price ? fieldError : {}),
              }}
            />
            {errors.employee_price && <span style={errorText}>{errors.employee_price}</span>}
          </div>

          {/* Label */}
          <div style={fieldWrap}>
            <label style={fieldLabelStyle}>
              {t('admin.employeeProducts.form.label')}
            </label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder={t('admin.employeeProducts.form.labelPlaceholder')}
              maxLength={200}
              style={{ ...textInput, width: '100%' }}
            />
          </div>

          {/* Display order */}
          <div style={fieldWrap}>
            <label style={fieldLabelStyle}>
              {t('admin.employeeProducts.form.displayOrder')}
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={form.display_order}
              onChange={(e) => set('display_order', e.target.value)}
              style={{
                ...textInput,
                width: 120,
                ...(errors.display_order ? fieldError : {}),
              }}
            />
            {errors.display_order && <span style={errorText}>{errors.display_order}</span>}
          </div>

          {/* Active toggle */}
          <div style={toggleRow}>
            <label style={fieldLabelStyle}>
              {t('admin.employeeProducts.form.active')}
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={form.active}
              onClick={() => set('active', !form.active)}
              style={{
                ...toggleTrack,
                background: form.active ? 'var(--green)' : 'var(--border)',
              }}
            >
              <span
                style={{
                  ...toggleThumb,
                  transform: form.active ? 'translateX(18px)' : 'translateX(2px)',
                }}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={modalFooter}>
          {isEdit && (
            <button
              type="button"
              style={confirmDelete ? btnDangerFilled : btnDanger}
              onClick={handleDelete}
              disabled={pending}
            >
              {confirmDelete
                ? t('admin.employeeProducts.form.deleteConfirm')
                : t('admin.employeeProducts.form.delete')}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            style={btnGhost}
            onClick={onClose}
            disabled={pending}
          >
            {t('admin.employeeProducts.form.cancel')}
          </button>
          <button
            type="button"
            style={btnPrimary}
            onClick={handleSave}
            disabled={pending}
          >
            {pending ? t('common.loading') : t('admin.employeeProducts.form.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────────── */

function Toast({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  return (
    <div
      role="status"
      style={{
        ...toastStyle,
        background: kind === 'ok' ? 'var(--green)' : 'var(--red)',
      }}
    >
      {text}
    </div>
  );
}

/* ── KPI sub-cell ───────────────────────────────────────────────────────── */

interface KpiCellProps {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
  muted?: boolean;
}

function KpiCell({ label, value, hint, valueColor, muted }: KpiCellProps) {
  return (
    <div style={kpiCellStyle}>
      <span style={kpiLabel}>{label}</span>
      <span
        style={{
          ...kpiValue,
          ...(valueColor ? { color: valueColor } : {}),
          ...(muted ? { color: 'var(--text2)' } : {}),
        }}
      >
        {value}
      </span>
      <span style={kpiHint}>{hint}</span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const COLS = 'minmax(200px, 2fr) 120px 120px 100px 80px';

const headerActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
};

const countPill: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const btnPrimary: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const kpiGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  marginBottom: 18,
};

const kpiCellStyle: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '14px 18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const kpiLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const kpiValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 26,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.05,
  letterSpacing: '-0.005em',
};

const kpiHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  marginTop: 2,
};

const filterBar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-end',
  marginBottom: 14,
};

const filterField: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const filterLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const textInput: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const pillRow: CSSProperties = {
  display: 'inline-flex',
  gap: 6,
};

const pillBtn: CSSProperties = {
  padding: '7px 13px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  minHeight: 34,
};

const pillBtnActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const tableShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  marginTop: 6,
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  width: '100%',
  padding: '13px 20px',
  borderTop: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 48,
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const cellNumGold: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--gold)',
};

const cellNumMuted: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
  color: 'var(--text3)',
};

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const nameMain: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const typeCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const typeBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const statusBadgeOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const statusBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '64px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'center',
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  color: 'var(--text2)',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: 0,
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 18px',
  borderRadius: 999,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  zIndex: 300,
  boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
};

/* ── Modal styles ──────────────────────────────────────────────────────── */

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalBox: CSSProperties = {
  width: 520,
  maxWidth: '95vw',
  maxHeight: '88vh',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const modalHeader: CSSProperties = {
  padding: '18px 22px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const modalCloseBtn: CSSProperties = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text3)',
  fontSize: 20,
  borderRadius: 6,
  fontFamily: 'inherit',
};

const modalBody: CSSProperties = {
  padding: '20px 22px',
  overflowY: 'auto',
  flex: 1,
};

const modalFooter: CSSProperties = {
  padding: '14px 22px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const fieldWrap: CSSProperties = {
  marginBottom: 14,
};

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
  marginBottom: 4,
};

const fieldError: CSSProperties = {
  borderColor: 'var(--red)',
};

const errorText: CSSProperties = {
  fontSize: 11,
  color: 'var(--red)',
  marginTop: 2,
  display: 'block',
};

const toggleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
};

const toggleTrack: CSSProperties = {
  width: 42,
  height: 24,
  borderRadius: 12,
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  transition: 'background 0.2s',
  flexShrink: 0,
};

const toggleThumb: CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  transition: 'transform 0.2s',
};

const btnGhost: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnDanger: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.25)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnDangerFilled: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--red)',
  background: 'var(--red)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
