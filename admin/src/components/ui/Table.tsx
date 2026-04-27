import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { useTranslation } from '../../i18n';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** When provided, the header becomes clickable and toggles sort for this key. */
  sortable?: boolean;
  /** CSS width fragment for the grid-template-columns track (e.g. '120px', '1fr'). */
  width?: string;
}

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  /** When true, no background fetch is pending but we still want to show the
   *  skeleton state (e.g. the very first load). */
  isInitialLoad?: boolean;
  error?: Error | null;
  emptyMessage?: ReactNode;
  emptySub?: ReactNode;
  emptyAction?: ReactNode;
  /** Load-more cursor pagination. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  isLoading,
  isInitialLoad,
  error,
  emptyMessage,
  emptySub,
  emptyAction,
  hasMore,
  onLoadMore,
  isLoadingMore,
  sort,
  onSortChange,
}: TableProps<T>) {
  const { t } = useTranslation();
  const gridTemplate = columns.map((c) => c.width ?? '1fr').join(' ');
  const resolvedEmpty = emptyMessage ?? t('common.noResults');

  if (error) {
    return (
      <div className="table-wrap">
        <EmptyState
          icon="⚠"
          message={t('error.failedLoad')}
          sub={error.message}
        />
      </div>
    );
  }

  if (isInitialLoad || (isLoading && rows.length === 0)) {
    return (
      <div className="table-wrap">
        <div className="loading-block">
          <span className="spinner" />
          {t('common.loading')}…
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <EmptyState message={resolvedEmpty} sub={emptySub} action={emptyAction} />
      </div>
    );
  }

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    const nextDir: SortDir =
      sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, dir: nextDir });
  };

  return (
    <div className="table-wrap">
      <div className="table-head" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((col) => {
          if (!col.sortable) return <div key={col.key}>{col.header}</div>;
          const isActive = sort?.key === col.key;
          const arrow = !isActive ? '' : sort.dir === 'asc' ? ' ▲' : ' ▼';
          return (
            <button
              key={col.key}
              type="button"
              onClick={() => toggleSort(col.key)}
              className="table-sort-btn"
              aria-label={`Sort by ${typeof col.header === 'string' ? col.header : col.key}`}
            >
              {col.header}
              <span className="sort-arrow">{arrow}</span>
            </button>
          );
        })}
      </div>

      {rows.map((row, idx) => {
        const key = getRowKey(row);
        return (
          <div
            key={key}
            className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
            style={{
              gridTemplateColumns: gridTemplate,
              cursor: onRowClick ? 'pointer' : 'default',
            }}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((col) => (
              <div key={col.key}>{col.render(row, idx)}</div>
            ))}
          </div>
        );
      })}

      {hasMore && (
        <div style={{ padding: 14, display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            loading={isLoadingMore}
            onClick={() => onLoadMore?.()}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
