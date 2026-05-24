// Supplier · Detail — full-page surface for one supplier.
//
// Replaces the right-hand drawer that SuppliersListView used to open. The
// page splits into three tabs (Info, Linked products, Purchase orders); the
// Info tab carries a View/Edit segmented control with an in-place form.
//
// Why the orchestrator owns the Info form state (not InfoTab):
//   The "Discard unsaved changes?" prompt has to fire in two unrelated
//   places — flipping the View/Edit toggle AND switching to another tab.
//   Putting `form` + `mode` here keeps a single source of truth for "is
//   this dirty?" and lets both events consult it via the same guard.
//
// Backend touch points
//   GET /api/v1/suppliers/:id              — supplier row
//   PATCH /api/v1/suppliers/:id            — Info-tab save
//   DELETE /api/v1/suppliers/:id           — soft delete (Deactivate)
//   GET /api/v1/packagings        — Linked products tab
//   GET /api/v1/purchases?supplier_id=…    — Purchase orders tab

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AdminViewShell } from '../AdminViewShell';
import { Spinner } from '../../../Spinner';
import { useTranslation } from '../../../../i18n';
import { ApiError } from '../../../../api/client';
import {
  deleteSupplier,
  getSupplier,
  updateSupplier,
  type Supplier,
  type SupplierWriteInput,
} from '../../../../api/suppliers';
import { InfoTab } from './InfoTab';
import { LinkedProductsTab } from './LinkedProductsTab';
import { PurchaseOrdersTab } from './PurchaseOrdersTab';
import { emptyToNull } from './supplierForm';
import { segmentBtn, segmentBtnOn, segmentWrap } from './segmented';

interface Props {
  supplierId: string;
  /** Name from the list row — shown as the identity heading before the
   *  GET /suppliers/:id round-trip finishes, so the page never flashes "—". */
  supplierName: string;
  onBack: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

type Tab = 'info' | 'products' | 'orders';
type Mode = 'view' | 'edit';

const FORM_KEYS = [
  'name',
  'contact_name',
  'phone',
  'email',
  'address',
  'credit_days',
  'notes',
] as const;

function initialFormFrom(s: Supplier): SupplierWriteInput {
  return {
    name: s.name,
    contact_name: s.contact_name,
    phone: s.phone,
    email: s.email,
    address: s.address,
    credit_days: s.credit_days,
    notes: s.notes,
  };
}

// Normalises null/empty so a blank field doesn't read as dirty against a
// null server value. credit_days falls back to 0 to match the form input's
// default for missing numbers.
function isDirty(form: SupplierWriteInput, s: Supplier): boolean {
  const baseline = initialFormFrom(s);
  return FORM_KEYS.some((k) => {
    if (k === 'credit_days') {
      return (form.credit_days ?? 0) !== (baseline.credit_days ?? 0);
    }
    const a = form[k];
    const b = baseline[k];
    const na = a == null || a === '' ? null : a;
    const nb = b == null || b === '' ? null : b;
    return na !== nb;
  });
}

export function SupplierDetailView({
  supplierId,
  supplierName,
  onBack,
  onSaved,
  onError,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const supplierQuery = useQuery({
    queryKey: ['admin', 'suppliers', supplierId, 'detail'],
    queryFn: () => getSupplier(supplierId),
    staleTime: 15_000,
    retry: (count, err) => {
      // 404 = supplier deleted in another session; don't keep retrying.
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  const supplier = supplierQuery.data ?? null;

  const [tab, setTab] = useState<Tab>('info');
  const [mode, setMode] = useState<Mode>('view');
  const [form, setForm] = useState<SupplierWriteInput>(() =>
    supplier ? initialFormFrom(supplier) : {},
  );

  // Re-sync the form from the server snapshot ONLY when we're in View mode.
  // During Edit, a background refetch (window focus, mutation invalidation,
  // etc.) must not clobber the operator's draft.
  useEffect(() => {
    if (mode === 'view' && supplier) {
      setForm(initialFormFrom(supplier));
    }
  }, [supplier, mode]);

  // 404 → bounce to the list. Show the error via the parent toast first so
  // the operator knows why they got punted. The `bouncedRef` guards against
  // re-entering after onBack has fired (otherwise a stale toast can flash).
  const bouncedRef = useRef(false);
  useEffect(() => {
    const err = supplierQuery.error;
    if (err instanceof ApiError && err.status === 404 && !bouncedRef.current) {
      bouncedRef.current = true;
      onError(t('admin.supplierDetail.notFound'));
      onBack();
    }
  }, [supplierQuery.error, onBack, onError, t]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const updateMut = useMutation({
    mutationFn: (input: SupplierWriteInput) =>
      updateSupplier(supplierId, input),
    onSuccess: (updated) => {
      onSaved(t('admin.supplierDetail.saved'));
      queryClient.setQueryData(
        ['admin', 'suppliers', supplierId, 'detail'],
        updated,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
      setMode('view');
    },
    onError: () => onError(t('admin.supplierDetail.saveFailed')),
  });

  const deactivateMut = useMutation({
    mutationFn: () => deleteSupplier(supplierId),
    onSuccess: () => {
      onSaved(t('admin.supplierDetail.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'suppliers', supplierId, 'detail'],
      });
    },
    onError: () => onError(t('admin.supplierDetail.saveFailed')),
  });

  const reactivateMut = useMutation({
    mutationFn: () => updateSupplier(supplierId, { active: true }),
    onSuccess: (updated) => {
      onSaved(t('admin.supplierDetail.reactivated'));
      queryClient.setQueryData(
        ['admin', 'suppliers', supplierId, 'detail'],
        updated,
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
    },
    onError: () => onError(t('admin.supplierDetail.saveFailed')),
  });

  // ─── Guards ───────────────────────────────────────────────────────────────

  const dirty = supplier ? isDirty(form, supplier) : false;

  const tryToggleMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      if (next === 'view' && dirty) {
        if (!window.confirm(t('admin.supplierDetail.discardPrompt'))) return;
        if (supplier) setForm(initialFormFrom(supplier));
      }
      setMode(next);
    },
    [mode, dirty, supplier, t],
  );

  const tryChangeTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      if (mode === 'edit' && dirty) {
        if (!window.confirm(t('admin.supplierDetail.discardPrompt'))) return;
        if (supplier) setForm(initialFormFrom(supplier));
        setMode('view');
      }
      setTab(next);
    },
    [tab, mode, dirty, supplier, t],
  );

  const handleSave = useCallback(() => {
    if (!supplier) return;
    // Mirror the original drawer's submit: trim everything, collapse empties
    // to null. Name falls back to the server value so an accidental clear
    // doesn't 400 us against the backend's min(1) check.
    const payload: SupplierWriteInput = {
      name: form.name?.trim() || supplier.name,
      contact_name: emptyToNull(form.contact_name),
      phone: emptyToNull(form.phone),
      email: emptyToNull(form.email),
      address: emptyToNull(form.address),
      credit_days: Number.isFinite(form.credit_days)
        ? (form.credit_days ?? 0)
        : 0,
      notes: emptyToNull(form.notes),
    };
    updateMut.mutate(payload);
  }, [form, supplier, updateMut]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const isActive = supplier ? supplier.active : true;

  const headerActions = useMemo(
    () =>
      supplier ? (
        <div style={headerActionRow}>
          <span
            style={{
              ...statusBadge,
              ...(isActive ? statusBadgeOk : statusBadgeOff),
            }}
          >
            {isActive
              ? t('admin.supplierDetail.status.active')
              : t('admin.supplierDetail.status.inactive')}
          </span>
          {isActive ? (
            <button
              type="button"
              style={btnDangerSm}
              onClick={() => deactivateMut.mutate()}
              disabled={deactivateMut.isPending}
            >
              {t('admin.supplierDetail.deactivate')}
            </button>
          ) : (
            <button
              type="button"
              style={btnGhostSm}
              onClick={() => reactivateMut.mutate()}
              disabled={reactivateMut.isPending}
            >
              {t('admin.supplierDetail.reactivate')}
            </button>
          )}
        </div>
      ) : null,
    [supplier, isActive, deactivateMut, reactivateMut, t],
  );

  return (
    <AdminViewShell
      titleKey="admin.supplierDetail.title"
      onBack={onBack}
      headerActions={headerActions}
    >
      {supplierQuery.isLoading && !supplier && (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      )}

      {supplierQuery.error && !supplier && !bouncedRef.current && (
        <p style={errorBanner}>{t('admin.supplierDetail.failed')}</p>
      )}

      {supplier && (
        <div style={pageBody}>
          <header style={identityBlock}>
            <h2 style={identityName}>{supplier.name || supplierName}</h2>
            <p style={identityCaption}>
              {supplier.contact_name ||
                supplier.phone ||
                supplier.email ||
                t('admin.supplierDetail.value.none')}
            </p>
          </header>

          <div style={tabsRow} role="tablist">
            <TabButton
              active={tab === 'info'}
              onClick={() => tryChangeTab('info')}
              label={t('admin.supplierDetail.tab.info')}
            />
            <TabButton
              active={tab === 'products'}
              onClick={() => tryChangeTab('products')}
              label={t('admin.supplierDetail.tab.products')}
            />
            <TabButton
              active={tab === 'orders'}
              onClick={() => tryChangeTab('orders')}
              label={t('admin.supplierDetail.tab.orders')}
            />
          </div>

          {tab === 'info' && (
            <InfoTab
              supplier={supplier}
              mode={mode}
              form={form}
              onFormChange={setForm}
              onRequestMode={tryToggleMode}
              onSave={handleSave}
              saving={updateMut.isPending}
            />
          )}
          {tab === 'products' && (
            <LinkedProductsTab
              supplier={supplier}
              onSaved={onSaved}
              onError={onError}
            />
          )}
          {tab === 'orders' && <PurchaseOrdersTab supplier={supplier} />}
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      style={active ? segmentBtnOn : segmentBtn}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const pageBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
  paddingBottom: 32,
};

const identityBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const identityName: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 30,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
  lineHeight: 1.1,
};

const identityCaption: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: 'var(--text3)',
};

const tabsRow: CSSProperties = {
  ...segmentWrap,
  alignSelf: 'flex-start',
};

const headerActionRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '4px 11px',
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

const btnGhostSm: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};

const btnDangerSm: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const errorBanner: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
};
