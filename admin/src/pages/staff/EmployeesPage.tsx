import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useEmployees } from '../../hooks/useEmployees';
import type { Employee } from '../../types/staff';
import type { UserRole } from '../../types/api';
import { formatDate, formatMoney } from '../../utils/format';
import { EmployeeFormModal } from './EmployeeFormModal';
import { useTranslation } from '../../i18n';

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER', 'BARISTA'];

function useRoleLabel() {
  const { t } = useTranslation();
  return (role: UserRole): string => {
    switch (role) {
      case 'ADMIN':   return t('role.admin');
      case 'MANAGER': return t('role.manager');
      case 'CASHIER': return t('role.cashier');
      case 'BARISTA': return t('role.barista');
    }
  };
}

function roleTone(role: UserRole) {
  switch (role) {
    case 'ADMIN':   return 'gold' as const;
    case 'MANAGER': return 'blue' as const;
    case 'CASHIER': return 'green' as const;
    case 'BARISTA': return 'gray' as const;
  }
}

export function EmployeesPage() {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      role: (role || undefined) as UserRole | undefined,
      active: showInactive ? undefined : true,
    }),
    [search, role, showInactive],
  );

  const q = useEmployees(filters);
  const rows = useMemo<Employee[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const columns: TableColumn<Employee>[] = [
    {
      key: 'name',
      header: t('employees.colName'),
      width: '1.4fr',
      render: (e) => (
        <div>
          <div className="fw-600 fs-13">{e.name}</div>
          <div className="fs-11 text-muted">{e.email}</div>
        </div>
      ),
    },
    {
      key: 'position',
      header: t('employees.position'),
      width: '1fr',
      render: (e) => (
        <span className="fs-13">{e.position ?? '—'}</span>
      ),
    },
    {
      key: 'role',
      header: t('employees.colRole'),
      width: '130px',
      render: (e) => (
        <Badge tone={roleTone(e.role)}>{roleLabel(e.role)}</Badge>
      ),
    },
    {
      key: 'salary',
      header: t('employees.colSalary'),
      width: '140px',
      render: (e) => (
        <span className="fw-600 fs-13">
          {e.weekly_salary ? formatMoney(Number(e.weekly_salary)) : '—'}
        </span>
      ),
    },
    {
      key: 'hire',
      header: t('employees.colHired'),
      width: '130px',
      render: (e) => (
        <span className="fs-12 text-muted">
          {e.hire_date ? formatDate(e.hire_date) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '100px',
      render: (e) => (
        <Badge tone={e.active ? 'green' : 'gray'}>
          {e.active ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <div className="flex-between mb-12">
        <div />
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          + {t('employees.newEmployee')}
        </Button>
      </div>

      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            {t('common.search')}
          </label>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('common.search')}
          />
        </div>

        <div style={{ flex: '0 0 200px' }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            {t('employees.colRole')}
          </label>
          <select
            className="search-box"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </div>

        <label
          className="filter-pill"
          style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t('supplies.showInactive')}
        </label>
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(e) => e.id}
        onRowClick={(e) => navigate(`/staff/employees/${e.id}`)}
        isInitialLoad={q.isLoading}
        error={q.error as Error | null}
        emptyMessage={t('employees.empty')}
        emptySub={t('employees.subtitle')}
        hasMore={!!q.hasNextPage}
        isLoadingMore={q.isFetchingNextPage}
        onLoadMore={() => q.fetchNextPage()}
      />

      <EmployeeFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
    </>
  );
}
