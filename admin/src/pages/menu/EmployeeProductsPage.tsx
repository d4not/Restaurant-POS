import { useMemo, useState } from 'react';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  useEmployeeProducts,
  useDeleteEmployeeProduct,
} from '../../hooks/useEmployeeProducts';
import type { EmployeeProduct } from '../../api/employee-products';
import { formatMoney } from '../../utils/format';
import { EmployeeProductFormModal } from './EmployeeProductFormModal';
import { useTranslation } from '../../i18n';

export function EmployeeProductsPage() {
  const { t } = useTranslation();
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeProduct | null>(null);

  const filters = useMemo(
    () => ({ active: showInactive ? undefined : true }),
    [showInactive],
  );

  const query = useEmployeeProducts(filters);
  const deleteM = useDeleteEmployeeProduct();

  const rows = useMemo<EmployeeProduct[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (row: EmployeeProduct) => {
    setEditing(row);
    setModalOpen(true);
  };

  // The displayed name is either the admin's override label, or the linked
  // product/variant snapshot. Renders inline with a discreet "variant" tag
  // when a specific variant is targeted.
  const displayName = (r: EmployeeProduct): React.ReactNode => {
    if (r.label) {
      return (
        <div>
          <div className="fw-600 fs-13">{r.label}</div>
          <div className="text-muted fs-11">
            {r.product.name}
            {r.variant ? ` · ${r.variant.name}` : ''}
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="fw-600 fs-13">{r.product.name}</div>
        {r.variant && (
          <div className="text-muted fs-11">{r.variant.name}</div>
        )}
      </div>
    );
  };

  const handleDelete = async (row: EmployeeProduct) => {
    if (!confirm(t('employeeProducts.deleteConfirm'))) return;
    await deleteM.mutateAsync(row.id);
  };

  const columns: TableColumn<EmployeeProduct>[] = [
    {
      key: 'name',
      header: t('employeeProducts.colName'),
      width: '2fr',
      render: (r) => displayName(r),
    },
    {
      key: 'employee_price',
      header: t('employeeProducts.colEmployeePrice'),
      width: '160px',
      render: (r) => (
        <span className="fw-600 fs-13 text-gold">
          {formatMoney(r.employee_price)}
        </span>
      ),
    },
    {
      key: 'reg_price',
      header: t('employeeProducts.colRegularPrice'),
      width: '160px',
      render: (r) => {
        const reg = r.variant?.sell_price ?? '0';
        const regNum = Number(reg);
        if (!regNum) return <span className="fs-12 text-muted">—</span>;
        return (
          <span className="text-muted fs-12">{formatMoney(reg)}</span>
        );
      },
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '110px',
      render: (r) =>
        r.active ? (
          <Badge tone="green">{t('common.active')}</Badge>
        ) : (
          <Badge tone="gray">{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (r) => (
        <div className="flex gap-8" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
            {t('common.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDelete(r)}
            loading={deleteM.isPending}
          >
            {t('common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <button
          type="button"
          className={`filter-pill ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? `✓ ${t('common.inactive')}` : t('supplies.showInactive')}
        </button>

        <div style={{ flex: 1 }} />

        <Button variant="primary" onClick={openCreate}>
          + {t('employeeProducts.newEntry')}
        </Button>
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        onRowClick={openEdit}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('employeeProducts.empty')}
        emptySub={t('employeeProducts.emptySub')}
        emptyAction={
          <Button variant="primary" onClick={openCreate}>
            + {t('employeeProducts.newEntry')}
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <EmployeeProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        entry={editing}
      />
    </>
  );
}
