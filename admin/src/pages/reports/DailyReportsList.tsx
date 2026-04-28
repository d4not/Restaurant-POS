import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { useDailyReports } from '../../hooks/useDailyReports';
import type { DailyReport } from '../../api/daily-reports';
import { formatDate, formatMoney } from '../../utils/format';

function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

export function DailyReportsList() {
  const navigate = useNavigate();
  const query = useDailyReports();
  const rows = useMemo<DailyReport[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const columns: TableColumn<DailyReport>[] = [
    {
      key: 'folio',
      header: 'Folio',
      width: '120px',
      render: (r) => <span className="fw-600 fs-13">{folioLabel(r.folio)}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      width: '140px',
      render: (r) => <span className="fs-13">{formatDate(r.date)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (r) => (
        <Badge tone={r.status === 'CLOSED' ? 'green' : 'gold'}>{r.status}</Badge>
      ),
    },
    {
      key: 'shifts',
      header: 'Shifts',
      width: '110px',
      render: (r) => (
        <span className="fs-13">
          {r.total_shifts}
          {r.unverified_provisionals > 0 && (
            <span className="text-red"> · {r.unverified_provisionals} unverified</span>
          )}
        </span>
      ),
    },
    {
      key: 'tickets',
      header: 'Tickets',
      width: '90px',
      render: (r) => <span className="fs-13">{r.total_tickets}</span>,
    },
    {
      key: 'gross',
      header: 'Gross',
      width: '120px',
      render: (r) => (
        <span className="fw-600 fs-13">{formatMoney(r.gross_sales)}</span>
      ),
    },
    {
      key: 'net',
      header: 'Net',
      width: '120px',
      render: (r) => <span className="fs-13">{formatMoney(r.net_sales)}</span>,
    },
    {
      key: 'variance',
      header: 'Variance',
      width: '120px',
      render: (r) => {
        if (r.total_cash_variance == null) {
          return <span className="fs-12 text-muted">—</span>;
        }
        const v = r.total_cash_variance;
        if (v === 0) {
          return <span className="fs-13 text-muted">{formatMoney(0)}</span>;
        }
        const cls = v > 0 ? 'text-green' : 'text-red';
        const sign = v > 0 ? '+' : '';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatMoney(v)}
          </span>
        );
      },
    },
  ];

  return (
    <Card title="Daily reports">
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/reports/daily/${r.id}`)}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage="No daily reports yet"
        emptySub="Close a shift and run the day-close action from the terminal"
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </Card>
  );
}
