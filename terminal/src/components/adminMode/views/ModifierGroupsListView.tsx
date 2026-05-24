// Catalog · Modifier Groups — list + dispatcher.
//
// The list itself (KPI strip + filter toolbar + table) is what the user lands
// on; tapping a row pushes ModifierGroupDetailView for editing modifiers,
// linked products, etc. The "+ New" header action opens a modal for quick
// creation, then navigates to the detail view.
//
// Backend touch points
//   GET    /api/v1/modifier-groups            — paginated catalog (drained)
//   POST   /api/v1/modifier-groups            — create
//   (CRUD lives in ModifierGroupDetailView)

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import {
  useAllModifierGroups,
  useCreateModifierGroup,
} from '../../../hooks/useModifierGroups';
import type { ModifierGroupType } from '../../../api/products';
import type { CreateModifierGroupInput } from '../../../api/modifier-groups';
import { ModifierGroupDetailView } from './ModifierGroupDetailView';

type TypeFilter = 'ALL' | ModifierGroupType;

type SubView =
  | { kind: 'list' }
  | { kind: 'detail'; groupId: string };

interface Props {
  onBack: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

/* ── Component ──────────────────────────────────────────────────────────── */

export function ModifierGroupsListView({ onBack }: Props) {
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  if (subView.kind === 'detail') {
    return (
      <>
        <ModifierGroupDetailView
          groupId={subView.groupId}
          onBack={() => setSubView({ kind: 'list' })}
          onSaved={(text) => setToast({ kind: 'ok', text })}
          onError={(text) => setToast({ kind: 'err', text })}
        />
        {toast && <Toast kind={toast.kind} text={toast.text} />}
      </>
    );
  }

  return (
    <>
      <ModifierGroupsList
        onBack={onBack}
        onOpen={(id) => setSubView({ kind: 'detail', groupId: id })}
      />
      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </>
  );
}

/* ── List screen ────────────────────────────────────────────────────────── */

interface ListProps {
  onBack: () => void;
  onOpen: (groupId: string) => void;
}

function ModifierGroupsList({ onBack, onOpen }: ListProps) {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const groupsQuery = useAllModifierGroups();
  const allRows = groupsQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((g) => {
      if (typeFilter !== 'ALL' && g.type !== typeFilter) return false;
      if (q) {
        if (!g.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allRows, search, typeFilter]);

  // KPI metrics — derived from the full fetched list, not the filtered set.
  const kpis = useMemo(() => {
    const total = allRows.length;
    let swap = 0;
    let add = 0;
    let empty = 0;
    for (const g of allRows) {
      if (g.type === 'SWAP') swap += 1;
      if (g.type === 'ADD') add += 1;
      if (g.modifiers.length === 0) empty += 1;
    }
    return { total, swap, add, empty };
  }, [allRows]);

  const isLoading = groupsQuery.isLoading;

  const countLabel =
    filtered.length === 1
      ? t('admin.modifierGroups.count.shownOne')
      : interpolate(t('admin.modifierGroups.count.shown'), { count: filtered.length });

  return (
    <AdminViewShell
      titleKey="admin.modifierGroups.title"
      subtitleKey="admin.modifierGroups.subtitle"
      onBack={onBack}
      headerActions={
        <span style={headerActions}>
          <span style={countPill} aria-live="polite">
            {countLabel}
          </span>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => setShowCreateModal(true)}
          >
            {t('admin.modifierGroups.newBtn')}
          </button>
        </span>
      }
    >
      {/* KPI strip */}
      <div style={kpiGrid}>
        <KpiCell
          label={t('admin.modifierGroups.kpi.total')}
          value={String(kpis.total)}
          hint={t('admin.modifierGroups.kpi.totalHint')}
        />
        <KpiCell
          label={t('admin.modifierGroups.kpi.swap')}
          value={String(kpis.swap)}
          hint={t('admin.modifierGroups.kpi.swapHint')}
        />
        <KpiCell
          label={t('admin.modifierGroups.kpi.add')}
          value={String(kpis.add)}
          hint={t('admin.modifierGroups.kpi.addHint')}
        />
        <KpiCell
          label={t('admin.modifierGroups.kpi.empty')}
          value={String(kpis.empty)}
          hint={t('admin.modifierGroups.kpi.emptyHint')}
          valueColor={kpis.empty > 0 ? 'var(--red)' : undefined}
        />
      </div>

      {/* Filter toolbar */}
      <div style={filterBar}>
        <label style={{ ...filterField, flex: 1, minWidth: 240 }}>
          <span style={filterLabel}>{t('admin.modifierGroups.filter.search')}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.modifierGroups.filter.searchPlaceholder')}
            style={textInput}
          />
        </label>

        <div style={filterField}>
          <span style={filterLabel}>{t('admin.modifierGroups.filter.type')}</span>
          <div style={pillRow}>
            {(['ALL', 'SWAP', 'ADD'] as TypeFilter[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTypeFilter(tf)}
                style={{ ...pillBtn, ...(typeFilter === tf ? pillBtnActive : {}) }}
              >
                {tf === 'ALL'
                  ? t('admin.modifierGroups.filter.typeAll')
                  : tf === 'SWAP'
                    ? t('admin.modifierGroups.filter.typeSwap')
                    : t('admin.modifierGroups.filter.typeAdd')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={tableShell}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('admin.modifierGroups.col.name')}</span>
          <span>{t('admin.modifierGroups.col.type')}</span>
          <span>{t('admin.modifierGroups.col.selection')}</span>
          <span style={cellNumHead}>{t('admin.modifierGroups.col.modifiers')}</span>
          <span>{t('admin.modifierGroups.col.status')}</span>
        </div>

        {isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={emptyState}>
            <p style={emptyTitle}>{t('admin.modifierGroups.empty')}</p>
            <p style={emptyHint}>{t('admin.modifierGroups.emptyHint')}</p>
          </div>
        )}

        {!isLoading &&
          filtered.map((row) => {
            const modCount = row.modifiers.length;
            const selectionLabel = `${row.min_selection}–${row.max_selection}`;

            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpen(row.id)}
                style={{ ...tableRow, gridTemplateColumns: COLS }}
              >
                <span style={nameCell}>
                  <span style={nameMain}>
                    {row.name}
                    {row.required && (
                      <span style={requiredBadge}>
                        {t('admin.modifierGroups.badge.required')}
                      </span>
                    )}
                  </span>
                </span>
                <span style={typeCell}>
                  <span
                    style={{
                      ...typeBadge,
                      ...(row.type === 'SWAP' ? typeBadgeSwap : typeBadgeAdd),
                    }}
                  >
                    {row.type}
                  </span>
                </span>
                <span style={cellMuted}>{selectionLabel}</span>
                <span style={cellNum}>{modCount}</span>
                <span>
                  {modCount === 0 ? (
                    <span style={{ ...statusBadge, ...statusBadgeEmpty }}>
                      {t('admin.modifierGroups.status.empty')}
                    </span>
                  ) : (
                    <span style={{ ...statusBadge, ...statusBadgeOk }}>
                      {modCount === 1 ? '1 modifier' : `${modCount} modifiers`}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <ModifierGroupFormModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(id) => {
            setShowCreateModal(false);
            onOpen(id);
          }}
        />
      )}
    </AdminViewShell>
  );
}

/* ── Create modal ──────────────────────────────────────────────────────── */

interface FormModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

function ModifierGroupFormModal({ onClose, onCreated }: FormModalProps) {
  const { t } = useTranslation();
  const createMut = useCreateModifierGroup();

  const [name, setName] = useState('');
  const [type, setType] = useState<ModifierGroupType>('SWAP');
  const [minSelection, setMinSelection] = useState(0);
  const [maxSelection, setMaxSelection] = useState(1);
  const [required, setRequired] = useState(false);
  const [displayOrder, setDisplayOrder] = useState(0);
  const [error, setError] = useState('');

  // Trap Esc inside the modal so the shell does not close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('admin.modifierGroups.form.nameRequired'));
      return;
    }
    setError('');
    try {
      const input: CreateModifierGroupInput = {
        name: trimmed,
        type,
        min_selection: minSelection,
        max_selection: maxSelection,
        required,
        display_order: displayOrder,
      };
      const created = await createMut.mutateAsync(input);
      onCreated(created.id);
    } catch (err: any) {
      setError(err?.message ?? t('common.unknownError'));
    }
  }

  return (
    <div style={modalScrim} onClick={onClose}>
      <div
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={modalHeader}>
          <h3 style={modalTitle}>{t('admin.modifierGroups.form.title')}</h3>
        </div>

        <div style={modalBody}>
          {/* Name */}
          <label style={fieldWrap}>
            <span style={fieldLabel}>{t('admin.modifierGroups.form.name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.modifierGroups.form.namePlaceholder')}
              style={textInput}
              autoFocus
            />
          </label>

          {/* Type */}
          <div style={fieldWrap}>
            <span style={fieldLabel}>{t('admin.modifierGroups.form.type')}</span>
            <div style={pillRow}>
              {(['SWAP', 'ADD'] as ModifierGroupType[]).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setType(tp)}
                  style={{ ...pillBtn, ...(type === tp ? pillBtnActive : {}) }}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>

          {/* Min / Max selection */}
          <div style={{ display: 'flex', gap: 14 }}>
            <label style={{ ...fieldWrap, flex: 1 }}>
              <span style={fieldLabel}>{t('admin.modifierGroups.form.minSelection')}</span>
              <input
                type="number"
                min={0}
                value={minSelection}
                onChange={(e) => setMinSelection(Math.max(0, Number(e.target.value) || 0))}
                style={textInput}
              />
            </label>
            <label style={{ ...fieldWrap, flex: 1 }}>
              <span style={fieldLabel}>{t('admin.modifierGroups.form.maxSelection')}</span>
              <input
                type="number"
                min={1}
                value={maxSelection}
                onChange={(e) => setMaxSelection(Math.max(1, Number(e.target.value) || 1))}
                style={textInput}
              />
            </label>
          </div>

          {/* Required + Display order */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <div style={{ ...fieldWrap, flex: 0 }}>
              <span style={fieldLabel}>{t('admin.modifierGroups.form.required')}</span>
              <button
                type="button"
                onClick={() => setRequired((prev) => !prev)}
                style={{
                  ...toggleBtn,
                  background: required ? 'var(--green)' : 'var(--border)',
                }}
              >
                <span
                  style={{
                    ...toggleKnob,
                    transform: required ? 'translateX(18px)' : 'translateX(0)',
                  }}
                />
              </button>
            </div>
            <label style={{ ...fieldWrap, flex: 1 }}>
              <span style={fieldLabel}>{t('admin.modifierGroups.form.displayOrder')}</span>
              <input
                type="number"
                min={0}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(Math.max(0, Number(e.target.value) || 0))}
                style={textInput}
              />
            </label>
          </div>

          {/* Error */}
          {error && <p style={errorText}>{error}</p>}
        </div>

        <div style={modalFooter}>
          <button type="button" style={btnGhost} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={btnPrimary}
            onClick={handleSubmit}
            disabled={createMut.isPending}
          >
            {createMut.isPending
              ? t('common.loading')
              : t('admin.modifierGroups.form.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Toast (reused across sub-views) ────────────────────────────────────── */

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

const COLS = 'minmax(240px, 2.5fr) 120px 130px 100px 120px';

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

const btnGhost: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
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
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const requiredBadge: CSSProperties = {
  display: 'inline-block',
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  background: 'rgba(201,164,92,0.16)',
  color: 'var(--gold)',
  border: '1px solid rgba(201,164,92,0.30)',
  flexShrink: 0,
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

const typeBadgeSwap: CSSProperties = {
  background: 'rgba(201,164,92,0.14)',
  color: '#8a6d2a',
  border: '1px solid rgba(201,164,92,0.30)',
};

const typeBadgeAdd: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const cellMuted: CSSProperties = {
  color: 'var(--text2)',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
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

const statusBadgeEmpty: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text3)',
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

/* ── Modal styles ───────────────────────────────────────────────────────── */

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: 460,
  maxWidth: '92vw',
  background: 'var(--bg2)',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const modalHeader: CSSProperties = {
  padding: '20px 24px 16px',
  borderBottom: '1px solid var(--border)',
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const modalBody: CSSProperties = {
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const modalFooter: CSSProperties = {
  padding: '14px 24px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const fieldWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text2)',
  letterSpacing: '0.04em',
};

const toggleBtn: CSSProperties = {
  width: 42,
  height: 24,
  borderRadius: 12,
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  padding: 3,
  transition: 'background 0.15s',
  display: 'flex',
  alignItems: 'center',
  minHeight: 24,
};

const toggleKnob: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
  transition: 'transform 0.15s',
};

const errorText: CSSProperties = {
  fontSize: 12,
  color: 'var(--red)',
  margin: 0,
};
