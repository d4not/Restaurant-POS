import { useMemo, useState } from 'react';
import { Button, Badge, EmptyState } from '../../components/ui';
import {
  useDeleteProductCategory,
  useProductCategories,
} from '../../hooks/useProductCategories';
import type { ProductCategory } from '../../types/menu';
import { CategoryFormModal } from './CategoryFormModal';
import { useTranslation } from '../../i18n';

interface TreeNode {
  category: ProductCategory;
  children: TreeNode[];
}

function buildTree(categories: ProductCategory[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const c of categories) byId.set(c.id, { category: c, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.category.parent_id;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort each level by display_order, then name.
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const d = a.category.display_order - b.category.display_order;
      if (d !== 0) return d;
      return a.category.name.localeCompare(b.category.name);
    });
    for (const n of nodes) sortLevel(n.children);
  };
  sortLevel(roots);
  return roots;
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const categoriesQ = useProductCategories();
  const deleteM = useDeleteProductCategory();

  const [modal, setModal] = useState<{
    open: boolean;
    category: ProductCategory | null;
    defaultParentId: string | null;
  }>({ open: false, category: null, defaultParentId: null });

  const roots = useMemo(() => {
    const items = categoriesQ.data?.items ?? [];
    return buildTree(items);
  }, [categoriesQ.data]);

  const openCreate = (parentId: string | null = null) => {
    setModal({ open: true, category: null, defaultParentId: parentId });
  };
  const openEdit = (category: ProductCategory) => {
    setModal({ open: true, category, defaultParentId: null });
  };
  const closeModal = () => {
    setModal({ open: false, category: null, defaultParentId: null });
  };

  const onDelete = async (c: ProductCategory) => {
    if (!confirm(`${t('categories.deleteConfirm')} "${c.name}"`)) return;
    try {
      await deleteM.mutateAsync(c.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('error.somethingWrong'));
    }
  };

  if (categoriesQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        {t('common.loading')}…
      </div>
    );
  }

  if (categoriesQ.error) {
    return (
      <EmptyState
        icon="⚠"
        message={t('error.failedLoad')}
        sub={(categoriesQ.error as Error).message}
      />
    );
  }

  return (
    <>
      <div className="toolbar">
        <div style={{ flex: 1 }} />
        <Button variant="primary" onClick={() => openCreate(null)}>
          + {t('categories.newCategory')}
        </Button>
      </div>

      {roots.length === 0 ? (
        <EmptyState
          message={t('categories.empty')}
          sub={t('categories.subtitle')}
          action={
            <Button variant="primary" onClick={() => openCreate(null)}>
              + {t('categories.newCategory')}
            </Button>
          }
        />
      ) : (
        <div className="category-tree card" style={{ padding: 8 }}>
          {roots.map((node) => (
            <TreeRow
              key={node.category.id}
              node={node}
              depth={0}
              onEdit={openEdit}
              onDelete={onDelete}
              onAddChild={openCreate}
              deleting={deleteM.isPending}
            />
          ))}
        </div>
      )}

      <CategoryFormModal
        open={modal.open}
        onClose={closeModal}
        category={modal.category}
        defaultParentId={modal.defaultParentId}
      />
    </>
  );
}

/* ───────────────────────────────────────────────────────── */

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  onEdit: (c: ProductCategory) => void;
  onDelete: (c: ProductCategory) => void;
  onAddChild: (parentId: string) => void;
  deleting: boolean;
}

function TreeRow({
  node,
  depth,
  onEdit,
  onDelete,
  onAddChild,
  deleting,
}: TreeRowProps) {
  const { t } = useTranslation();
  const c = node.category;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="category-tree-row"
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        <div className="category-tree-label">
          <span
            aria-hidden
            className="category-tree-bullet"
            style={{
              background: c.color ?? 'var(--border)',
            }}
          />
          <div>
            <div className="fw-600 fs-13">{c.name}</div>
            {c.description && (
              <div className="fs-11 text-muted mt-4">{c.description}</div>
            )}
          </div>
        </div>

        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <span className="fs-11 text-muted">{t('categories.displayOrder')} {c.display_order}</span>
          {!c.visible_in_pos && <Badge tone="gray">{t('common.disabled')}</Badge>}
          {hasChildren && (
            <span className="fs-11 text-muted">
              {node.children.length} sub{node.children.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onAddChild(c.id)}
            title={t('categories.newCategory')}
          >
            + {t('common.add')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEdit(c)}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onDelete(c)}
            disabled={deleting}
            title={t('common.delete')}
          >
            ✕
          </button>
        </div>
      </div>

      {node.children.map((child) => (
        <TreeRow
          key={child.category.id}
          node={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          deleting={deleting}
        />
      ))}
    </>
  );
}
