// Catalog · Categories — tree view for managing product categories.
//
// Managers can create, edit, delete, and nest categories.
// The tree is built from the flat list using parent_id relationships.
//
// Backend touch points
//   GET    /api/v1/product-categories         — flat list
//   POST   /api/v1/product-categories         — create
//   PATCH  /api/v1/product-categories/:id     — update
//   DELETE /api/v1/product-categories/:id     — delete

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import {
  useProductCategoriesAdmin,
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeleteProductCategory,
} from '../../../hooks/useProductCategoriesAdmin';
import type {
  ProductCategory,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../../../api/product-categories';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface TreeNode {
  category: ProductCategory;
  children: TreeNode[];
  depth: number;
}

interface Props {
  onBack: () => void;
}

/* ── Tree builder ──────────────────────────────────────────────────────── */

function buildTree(cats: ProductCategory[]): TreeNode[] {
  const byParent = new Map<string | null, ProductCategory[]>();
  for (const c of cats) {
    const key = c.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  function walk(parentId: string | null, depth: number): TreeNode[] {
    const children = byParent.get(parentId) ?? [];
    children.sort(
      (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
    );
    return children.map((c) => ({
      category: c,
      children: walk(c.id, depth + 1),
      depth,
    }));
  }
  return walk(null, 0);
}

/** Collect all descendant IDs for a given category (to prevent cycle in parent picker). */
function collectDescendantIds(nodes: TreeNode[], targetId: string): Set<string> {
  const ids = new Set<string>();
  function find(list: TreeNode[]): TreeNode | null {
    for (const n of list) {
      if (n.category.id === targetId) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return null;
  }
  function gather(list: TreeNode[]) {
    for (const n of list) {
      ids.add(n.category.id);
      gather(n.children);
    }
  }
  const target = find(nodes);
  if (target) gather(target.children);
  return ids;
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function CategoriesListView({ onBack }: Props) {
  const { t } = useTranslation();
  const categoriesQ = useProductCategoriesAdmin();
  const createM = useCreateProductCategory();
  const updateM = useUpdateProductCategory();
  const deleteM = useDeleteProductCategory();

  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [modal, setModal] = useState<{
    open: boolean;
    category?: ProductCategory;
    defaultParentId?: string;
  }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<ProductCategory | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const allCats = categoriesQ.data ?? [];
  const tree = useMemo(() => buildTree(allCats), [allCats]);

  const kpis = useMemo(() => {
    const total = allCats.length;
    const topLevel = allCats.filter((c) => c.parent_id === null).length;
    const hidden = allCats.filter((c) => !c.visible_in_pos).length;
    return { total, topLevel, hidden };
  }, [allCats]);

  const childCountById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allCats) {
      if (c.parent_id) {
        m.set(c.parent_id, (m.get(c.parent_id) ?? 0) + 1);
      }
    }
    return m;
  }, [allCats]);

  const openCreate = (parentId?: string) =>
    setModal({ open: true, defaultParentId: parentId });
  const openEdit = (category: ProductCategory) =>
    setModal({ open: true, category });
  const closeModal = () => setModal({ open: false });

  const handleDelete = async (cat: ProductCategory) => {
    const subs = childCountById.get(cat.id) ?? 0;
    if (subs > 0) {
      setToast({ kind: 'err', text: t('admin.categories.deleteHasSubs') });
      return;
    }
    setConfirmDelete(cat);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteM.mutateAsync(confirmDelete.id);
      setToast({ kind: 'ok', text: t('admin.categories.deleted') });
    } catch (err) {
      setToast({
        kind: 'err',
        text: err instanceof Error ? err.message : t('error.somethingWrong'),
      });
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <AdminViewShell
        titleKey="admin.categories.title"
        subtitleKey="admin.categories.subtitle"
        onBack={onBack}
        headerActions={
          <button type="button" style={btnPrimary} onClick={() => openCreate()}>
            {t('admin.categories.newBtn')}
          </button>
        }
      >
        {/* KPI strip */}
        <div style={kpiGrid}>
          <KpiCell
            label={t('admin.categories.kpi.total')}
            value={String(kpis.total)}
            hint={t('admin.categories.kpi.totalHint')}
          />
          <KpiCell
            label={t('admin.categories.kpi.topLevel')}
            value={String(kpis.topLevel)}
            hint={t('admin.categories.kpi.topLevelHint')}
          />
          <KpiCell
            label={t('admin.categories.kpi.hidden')}
            value={String(kpis.hidden)}
            hint={t('admin.categories.kpi.hiddenHint')}
            valueColor={kpis.hidden > 0 ? 'var(--red)' : undefined}
          />
        </div>

        {/* Tree view */}
        {categoriesQ.isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}

        {!categoriesQ.isLoading && allCats.length === 0 && (
          <div style={emptyState}>
            <p style={emptyTitle}>{t('admin.categories.empty')}</p>
            <p style={emptyHint}>{t('admin.categories.emptyHint')}</p>
          </div>
        )}

        {!categoriesQ.isLoading && allCats.length > 0 && (
          <div style={treeShell}>
            {tree.map((node) => (
              <TreeRow
                key={node.category.id}
                node={node}
                childCountById={childCountById}
                onEdit={openEdit}
                onDelete={handleDelete}
                onAddChild={(parentId) => openCreate(parentId)}
                deleting={deleteM.isPending}
              />
            ))}
          </div>
        )}
      </AdminViewShell>

      {/* Category form modal */}
      {modal.open && (
        <CategoryFormModal
          category={modal.category}
          defaultParentId={modal.defaultParentId}
          allCategories={allCats}
          tree={tree}
          onClose={closeModal}
          onSaved={(msg) => {
            setToast({ kind: 'ok', text: msg });
            closeModal();
          }}
          onError={(msg) => setToast({ kind: 'err', text: msg })}
          createM={createM}
          updateM={updateM}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={modalScrim} onClick={() => setConfirmDelete(null)}>
          <div style={confirmBox} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text1)', margin: 0 }}>
              {t('admin.categories.deleteConfirm')}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '8px 0 0' }}>
              {confirmDelete.name}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                type="button"
                style={btnGhost}
                onClick={() => setConfirmDelete(null)}
              >
                {t('admin.categories.form.cancel')}
              </button>
              <button
                type="button"
                style={btnDanger}
                onClick={doDelete}
                disabled={deleteM.isPending}
              >
                {t('admin.categories.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </>
  );
}

/* ── Tree row ──────────────────────────────────────────────────────────── */

interface TreeRowProps {
  node: TreeNode;
  childCountById: Map<string, number>;
  onEdit: (c: ProductCategory) => void;
  onDelete: (c: ProductCategory) => void;
  onAddChild: (parentId: string) => void;
  deleting: boolean;
}

function TreeRow({
  node,
  childCountById,
  onEdit,
  onDelete,
  onAddChild,
  deleting,
}: TreeRowProps) {
  const { t } = useTranslation();
  const c = node.category;
  const subCount = childCountById.get(c.id) ?? 0;

  return (
    <>
      <div
        style={{
          ...treeRow,
          paddingLeft: 16 + node.depth * 24,
        }}
      >
        {/* Left: color dot + name + description */}
        <div style={treeRowLeft}>
          <span
            style={{
              ...colorDot,
              background: c.color ?? 'var(--border)',
            }}
          />
          <div style={treeRowInfo}>
            <span style={treeRowName}>{c.name}</span>
            {c.description && (
              <span style={treeRowDesc}>{c.description}</span>
            )}
          </div>
        </div>

        {/* Right: badges + actions */}
        <div style={treeRowRight}>
          {/* POS visibility badge */}
          <span
            style={{
              ...posBadge,
              ...(c.visible_in_pos ? posBadgeOn : posBadgeOff),
            }}
          >
            POS
          </span>

          {/* Subcategory count */}
          {subCount > 0 && (
            <span style={subBadge}>
              {subCount} sub{subCount === 1 ? '' : 's'}
            </span>
          )}

          {/* Actions */}
          <button
            type="button"
            style={actionBtn}
            onClick={() => onAddChild(c.id)}
            title={t('admin.categories.addSub')}
          >
            {t('admin.categories.addSub')}
          </button>
          <button
            type="button"
            style={actionBtn}
            onClick={() => onEdit(c)}
            title={t('admin.categories.edit')}
          >
            {t('admin.categories.edit')}
          </button>
          <button
            type="button"
            style={{ ...actionBtn, color: 'var(--red)' }}
            onClick={() => onDelete(c)}
            disabled={deleting}
            title={t('admin.categories.delete')}
          >
            {t('admin.categories.delete')}
          </button>
        </div>
      </div>

      {node.children.map((child) => (
        <TreeRow
          key={child.category.id}
          node={child}
          childCountById={childCountById}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          deleting={deleting}
        />
      ))}
    </>
  );
}

/* ── Category form modal ───────────────────────────────────────────────── */

interface CategoryFormModalProps {
  category?: ProductCategory;
  defaultParentId?: string;
  allCategories: ProductCategory[];
  tree: TreeNode[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  createM: ReturnType<typeof useCreateProductCategory>;
  updateM: ReturnType<typeof useUpdateProductCategory>;
}

function CategoryFormModal({
  category,
  defaultParentId,
  allCategories,
  tree,
  onClose,
  onSaved,
  onError,
  createM,
  updateM,
}: CategoryFormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!category;

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [color, setColor] = useState(category?.color ?? '');
  const [parentId, setParentId] = useState<string>(
    category?.parent_id ?? defaultParentId ?? '',
  );
  const [displayOrder, setDisplayOrder] = useState(
    category?.display_order ?? 0,
  );
  const [visibleInPos, setVisibleInPos] = useState(
    category?.visible_in_pos ?? true,
  );

  const saving = createM.isPending || updateM.isPending;

  // Exclude self and descendants from parent picker to prevent cycles
  const excludedIds = useMemo(() => {
    if (!category) return new Set<string>();
    const ids = collectDescendantIds(tree, category.id);
    ids.add(category.id);
    return ids;
  }, [category, tree]);

  const parentOptions = useMemo(
    () => allCategories.filter((c) => !excludedIds.has(c.id)),
    [allCategories, excludedIds],
  );

  // Prevent Esc from closing the admin view while modal is open
  useEffect(() => {
    const stopEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', stopEsc, true);
    return () => window.removeEventListener('keydown', stopEsc, true);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    try {
      if (isEdit) {
        const input: UpdateCategoryInput = {
          name: name.trim(),
          description: description.trim() || null,
          color: color.trim() || null,
          parent_id: parentId || null,
          display_order: displayOrder,
          visible_in_pos: visibleInPos,
        };
        await updateM.mutateAsync({ id: category!.id, input });
        onSaved(t('admin.categories.saved'));
      } else {
        const input: CreateCategoryInput = {
          name: name.trim(),
          description: description.trim() || null,
          color: color.trim() || null,
          parent_id: parentId || null,
          display_order: displayOrder,
          visible_in_pos: visibleInPos,
        };
        await createM.mutateAsync(input);
        onSaved(t('admin.categories.created'));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : t('error.somethingWrong'));
    }
  };

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            {isEdit
              ? t('admin.categories.form.titleEdit')
              : t('admin.categories.form.titleNew')}
          </h3>
          <button type="button" style={modalCloseBtn} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={modalBody}>
          {/* Name */}
          <label style={formField}>
            <span style={formLabel}>{t('admin.categories.form.name')}</span>
            <input
              style={formInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          {/* Description */}
          <label style={formField}>
            <span style={formLabel}>{t('admin.categories.form.description')}</span>
            <input
              style={formInput}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {/* Color */}
          <label style={formField}>
            <span style={formLabel}>{t('admin.categories.form.color')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                style={{ ...formInput, flex: 1 }}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder={t('admin.categories.form.colorPlaceholder')}
              />
              <span
                style={{
                  ...colorDotPreview,
                  background: color || 'var(--border)',
                }}
              />
            </div>
          </label>

          {/* Parent Category */}
          <label style={formField}>
            <span style={formLabel}>{t('admin.categories.form.parent')}</span>
            <select
              style={formInput}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{t('admin.categories.form.parentNone')}</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Display Order */}
          <label style={formField}>
            <span style={formLabel}>{t('admin.categories.form.displayOrder')}</span>
            <input
              style={{ ...formInput, width: 100 }}
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value) || 0)}
            />
          </label>

          {/* Visible in POS */}
          <label
            style={{
              ...formField,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={visibleInPos}
              onChange={(e) => setVisibleInPos(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--green)' }}
            />
            <span style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 500 }}>
              {t('admin.categories.form.visibleInPos')}
            </span>
          </label>
        </div>

        {/* Footer */}
        <div style={modalFooter}>
          <button type="button" style={btnGhost} onClick={onClose}>
            {t('admin.categories.form.cancel')}
          </button>
          <button
            type="button"
            style={btnPrimary}
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
          >
            {saving ? t('common.loading') + '...' : t('admin.categories.form.save')}
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

/* ── KPI sub-cell ──────────────────────────────────────────────────────── */

interface KpiCellProps {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
}

function KpiCell({ label, value, hint, valueColor }: KpiCellProps) {
  return (
    <div style={kpiCellStyle}>
      <span style={kpiLabel}>{label}</span>
      <span
        style={{
          ...kpiValue,
          ...(valueColor ? { color: valueColor } : {}),
        }}
      >
        {value}
      </span>
      <span style={kpiHint}>{hint}</span>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

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
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
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
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btnDanger: CSSProperties = {
  padding: '0 16px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--red)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
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

const treeShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  marginTop: 6,
};

const treeRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  gap: 12,
  minHeight: 48,
};

const treeRowLeft: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flex: 1,
  minWidth: 0,
};

const colorDot: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 4,
  flexShrink: 0,
};

const treeRowInfo: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const treeRowName: CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: 'var(--text1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const treeRowDesc: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 300,
};

const treeRowRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const posBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const posBadgeOn: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const posBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const subBadge: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  whiteSpace: 'nowrap',
};

const actionBtn: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 30,
  whiteSpace: 'nowrap',
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

const modalCard: CSSProperties = {
  width: 480,
  maxWidth: '95vw',
  maxHeight: '88vh',
  background: 'var(--bg2)',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
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
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text3)',
  borderRadius: 4,
  fontSize: 18,
  background: 'transparent',
  border: 'none',
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
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
};

const formField: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 14,
};

const formLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
};

const formInput: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const colorDotPreview: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid var(--border)',
  flexShrink: 0,
};

const confirmBox: CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 14,
  padding: '22px 24px',
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  maxWidth: 400,
  width: '90vw',
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
