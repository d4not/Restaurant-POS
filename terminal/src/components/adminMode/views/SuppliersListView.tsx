// Inventory · Suppliers — vendor catalog. Clicking a row opens a full-page
// SupplierDetailView (Info · Linked products · Purchase orders). Top-level
// header carries the "+ New supplier" CTA, which still pops a modal here
// because creation has nothing useful to do on the detail page itself.
//
// State
//   - The roster query owns the list and re-fetches when the active filter
//     changes. Search is local (case-insensitive across name/contact/phone/
//     email) since the full catalog rarely exceeds a few dozen suppliers.
//   - SubView dispatches between the list and the per-supplier detail. The
//     detail view manages its own queries/mutations; the parent only feeds
//     it the supplier id + name (for the loading-state heading).
//   - Packaging counts ride alongside the supplier list as a single drained
//     read; the detail view's LinkedProductsTab invalidates the same key on
//     write so the count column refreshes the moment the operator returns.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSupplier,
  listSuppliers,
  type CreateSupplierInput,
} from '../../../api/suppliers';
import { listPackagings } from '../../../api/packagings';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { Spinner } from '../../Spinner';

import { SupplierDetailView } from './supplierDetail/SupplierDetailView';
import {
  FieldNumber,
  FieldText,
  btnPrimary,
  btnSecondary,
  formFooter,
  formGrid,
  textInputStyle,
} from './supplierDetail/supplierForm';

interface SuppliersListViewProps {
  onBack: () => void;
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

type SubView =
  | { kind: 'list' }
  | { kind: 'detail'; supplierId: string; supplierName: string };

const COLS = '1.6fr 1.1fr 1fr 1.3fr 110px 100px 100px';

// ─── Public component ────────────────────────────────────────────────────

export function SuppliersListView({ onBack }: SuppliersListViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) return;
    const t0 = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t0);
  }, [toast]);

  const activeFilter: boolean | undefined =
    status === 'ALL' ? undefined : status === 'ACTIVE';

  const query = useQuery({
    queryKey: ['admin', 'suppliers', { active: activeFilter }],
    queryFn: () => listSuppliers({ active: activeFilter }),
    staleTime: 30_000,
  });

  // Per-supplier counts via a single drained read of active packagings; a
  // group-by endpoint would be cleaner but doesn't exist yet. The list helper
  // caps at 100 per page and drains the rest internally.
  const packagingCountQuery = useQuery({
    queryKey: ['admin', 'suppliers', 'pkgCounts'],
    queryFn: () => listPackagings({ active: true, limit: 100 }),
    staleTime: 30_000,
  });

  const packagingsBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of packagingCountQuery.data ?? []) {
      map.set(p.supplier_id, (map.get(p.supplier_id) ?? 0) + 1);
    }
    return map;
  }, [packagingCountQuery.data]);

  // Local filtering — listSuppliers drains the full catalog already, so the
  // server-side `search` round-trip would just add latency.
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => {
      const hay = [s.name, s.contact_name, s.phone, s.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query.data, search]);

  // ─── Detail dispatch ───────────────────────────────────────────────────
  // Mirrors the SubView pattern in ProductsListView / SuppliesListView —
  // the orchestrator stays the same parent component, just renders a
  // different child when a row is selected. AdminMode.tsx never sees it.
  if (subView.kind === 'detail') {
    return (
      <SupplierDetailView
        supplierId={subView.supplierId}
        supplierName={subView.supplierName}
        onBack={() => setSubView({ kind: 'list' })}
        onSaved={(text) => setToast({ kind: 'ok', text })}
        onError={(text) => setToast({ kind: 'err', text })}
      />
    );
  }

  const headerActions = (
    <button type="button" style={btnPrimary} onClick={() => setCreateOpen(true)}>
      {t('admin.suppliersList.new')}
    </button>
  );

  return (
    <AdminViewShell
      titleKey="admin.suppliersList.title"
      subtitleKey="admin.suppliersList.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      {/* ─── Filter row ──────────────────────────────────────────────────── */}
      <div style={adminStyles.filterRow as CSSProperties}>
        <div
          style={{
            ...(adminStyles.filterField as CSSProperties),
            flex: 1,
            minWidth: 240,
          }}
        >
          <span style={adminStyles.filterLabel as CSSProperties}>
            {t('admin.suppliersList.search')}
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.suppliersList.search')}
            style={textInputStyle}
          />
        </div>
        <div style={adminStyles.filterField as CSSProperties}>
          <span style={adminStyles.filterLabel as CSSProperties}>
            {t('admin.suppliersList.filter.status')}
          </span>
          <div style={adminStyles.pillRow as CSSProperties}>
            {(['ALL', 'ACTIVE', 'INACTIVE'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{
                  ...(adminStyles.pillBtn as CSSProperties),
                  ...(status === s
                    ? (adminStyles.pillBtnActive as CSSProperties)
                    : {}),
                }}
              >
                {s === 'ALL'
                  ? t('admin.suppliersList.filter.all')
                  : s === 'ACTIVE'
                    ? t('admin.suppliersList.filter.active')
                    : t('admin.suppliersList.filter.inactive')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Table ──────────────────────────────────────────────────────── */}
      <div style={tableWrap}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('admin.suppliersList.col.name')}</span>
          <span>{t('admin.suppliersList.col.contact')}</span>
          <span>{t('admin.suppliersList.col.phone')}</span>
          <span>{t('admin.suppliersList.col.email')}</span>
          <span style={cellNumHead}>
            {t('admin.suppliersList.col.packagings')}
          </span>
          <span style={cellNumHead}>
            {t('admin.suppliersList.col.credit')}
          </span>
          <span>{t('admin.suppliersList.col.status')}</span>
        </div>
        {query.isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}
        {!query.isLoading && rows.length === 0 && (
          <div style={emptyState}>{t('admin.suppliersList.empty')}</div>
        )}
        {rows.map((row) => {
          const pkgCount = packagingsBySupplier.get(row.id) ?? 0;
          const dim = !row.active;
          return (
            <button
              type="button"
              key={row.id}
              onClick={() =>
                setSubView({
                  kind: 'detail',
                  supplierId: row.id,
                  supplierName: row.name,
                })
              }
              style={{
                ...tableRow,
                gridTemplateColumns: COLS,
                opacity: dim ? 0.62 : 1,
              }}
            >
              <span style={nameCell}>
                <span style={nameMain}>{row.name}</span>
                <span style={nameSub}>
                  {row.address ? row.address : '—'}
                </span>
              </span>
              <span style={cellMuted}>{row.contact_name || '—'}</span>
              <span style={cellMuted}>{row.phone || '—'}</span>
              <span style={cellMuted}>{row.email || '—'}</span>
              <span style={cellNum}>{pkgCount > 0 ? pkgCount : '—'}</span>
              <span style={cellNum}>
                {row.credit_days > 0
                  ? `${row.credit_days}${t('admin.suppliersList.creditDaysSuffix')}`
                  : t('admin.suppliersList.creditNone')}
              </span>
              <span>
                <span
                  style={{
                    ...statusBadge,
                    ...(row.active ? statusBadgeOk : statusBadgeOff),
                  }}
                >
                  {row.active
                    ? t('admin.suppliersList.status.active')
                    : t('admin.suppliersList.status.inactive')}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── Create modal ───────────────────────────────────────────────── */}
      {createOpen && (
        <CreateSupplierModal
          onClose={() => setCreateOpen(false)}
          onSaved={(text) => {
            setToast({ kind: 'ok', text });
            setCreateOpen(false);
            queryClient.invalidateQueries({
              queryKey: ['admin', 'suppliers'],
            });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {/* ─── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div
          style={{
            ...toastStyle,
            background: toast.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          }}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Create supplier modal ─────────────────────────────────────────────────
// New-supplier creation stays a modal here: there's no useful detail view to
// open against a record that doesn't exist yet. After save, the parent
// invalidates the list query and (importantly) does NOT auto-navigate to the
// new supplier — operators usually create one in a flow ("got a quote, save
// their info, come back later").

interface CreateSupplierModalProps {
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function CreateSupplierModal({
  onClose,
  onSaved,
  onError,
}: CreateSupplierModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CreateSupplierInput>({
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    credit_days: 0,
    notes: '',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const createMut = useMutation({
    mutationFn: (input: CreateSupplierInput) => createSupplier(input),
    onSuccess: () => onSaved(t('admin.suppliersList.created')),
    onError: () => onError(t('admin.suppliersList.createFailed')),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = form.name.trim();
    if (!trimmed) return;
    // Backend rejects empty optional strings (email validation, etc.). Drop
    // them rather than forwarding "".
    const payload: CreateSupplierInput = {
      name: trimmed,
      contact_name: form.contact_name?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      email: form.email?.trim() || undefined,
      address: form.address?.trim() || undefined,
      credit_days: form.credit_days ?? 0,
      notes: form.notes?.trim() || undefined,
    };
    createMut.mutate(payload);
  }

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={modalTitle}>{t('admin.suppliersList.new')}</h3>
          <button type="button" onClick={onClose} style={modalCloseBtn}>
            ×
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 22px 22px' }}>
          <div style={formGrid}>
            <FieldText
              label={t('admin.suppliersList.field.name')}
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              required
              fullWidth
            />
            <FieldText
              label={t('admin.suppliersList.field.contactName')}
              value={form.contact_name ?? ''}
              onChange={(v) => setForm({ ...form, contact_name: v })}
            />
            <FieldText
              label={t('admin.suppliersList.field.phone')}
              value={form.phone ?? ''}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <FieldText
              label={t('admin.suppliersList.field.email')}
              value={form.email ?? ''}
              onChange={(v) => setForm({ ...form, email: v })}
              type="email"
            />
            <FieldNumber
              label={t('admin.suppliersList.field.creditDays')}
              value={form.credit_days ?? 0}
              min={0}
              max={365}
              onChange={(v) => setForm({ ...form, credit_days: v })}
            />
            <FieldText
              label={t('admin.suppliersList.field.address')}
              value={form.address ?? ''}
              onChange={(v) => setForm({ ...form, address: v })}
              fullWidth
            />
            <FieldText
              label={t('admin.suppliersList.field.notes')}
              value={form.notes ?? ''}
              onChange={(v) => setForm({ ...form, notes: v })}
              textarea
              fullWidth
            />
          </div>

          <div style={formFooter}>
            <button type="button" style={btnSecondary} onClick={onClose}>
              {t('admin.suppliersList.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="submit"
              style={btnPrimary}
              disabled={createMut.isPending}
            >
              {t('admin.suppliersList.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Styles (list page + create modal only) ────────────────────────────────

const tableWrap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  marginTop: 8,
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 18px',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '14px 18px',
  borderTop: '1px solid var(--border)',
  gap: 12,
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  width: '100%',
  minHeight: 56,
  transition: 'background 0.12s ease-out, opacity 0.15s ease-out',
};

const cellMuted: CSSProperties = {
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

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const nameMain: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const statusBadgeOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
};

const statusBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.18)',
  color: 'var(--text2)',
};

const spinnerWrap: CSSProperties = {
  padding: 28,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '60px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
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

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 250,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: 'min(720px, 94vw)',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
};

const modalHead: CSSProperties = {
  padding: '18px 22px 12px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const modalCloseBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
