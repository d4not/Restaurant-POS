import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  useRegister,
  useRegisterCashMovements,
} from '../../hooks/useRegisters';
import { useOrders } from '../../hooks/useOrders';
import type { CashMovement, Order } from '../../types/operations';
import { formatDateTime, formatMoney } from '../../utils/format';
import {
  cashMovementTypeTone,
  orderStatusTone,
  orderTypeTone,
  registerStatusTone,
} from './operations-meta';

export function ShiftDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const registerQ = useRegister(id);
  const register = registerQ.data;

  if (registerQ.isLoading) {
    return (
      <Card>
        <div className="loading-block">
          <span className="spinner" />
          Loading shift…
        </div>
      </Card>
    );
  }
  if (!register) {
    return (
      <Card>
        <div className="empty-state">
          <div className="icon">⚠</div>
          <div className="msg">Shift not found</div>
          {registerQ.error && (
            <div className="sub">{(registerQ.error as Error).message}</div>
          )}
        </div>
      </Card>
    );
  }

  const diff = register.difference == null ? null : Number(register.difference);
  const diffColor: 'green' | 'red' | 'default' =
    diff === null || diff === 0 ? 'default' : diff > 0 ? 'green' : 'red';

  return (
    <>
      <div className="flex-between mb-12">
        <Button variant="ghost" onClick={() => navigate('/cash/shifts')}>
          ← Back to shifts
        </Button>
        <Badge tone={registerStatusTone(register.status)}>{register.status}</Badge>
      </div>

      <div className="kpi-grid">
        <KPICard
          accent
          label="User"
          value={register.user?.name ?? '—'}
          sub={register.closed_at ? `Closed ${formatDateTime(register.closed_at)}` : 'Still open'}
        />
        <KPICard
          label="Opening"
          value={formatMoney(Number(register.opening_amount))}
          sub={formatDateTime(register.opened_at)}
        />
        <KPICard
          label="Expected"
          value={formatMoney(Number(register.expected_amount))}
          valueColor="gold"
        />
        <KPICard
          label="Actual"
          value={
            register.actual_amount == null
              ? '—'
              : formatMoney(Number(register.actual_amount))
          }
        />
        <KPICard
          label="Difference"
          value={
            diff === null
              ? '—'
              : `${diff > 0 ? '+' : ''}${formatMoney(diff)}`
          }
          valueColor={diffColor === 'default' ? 'default' : diffColor}
        />
      </div>

      {register.notes && (
        <Card title="Notes" className="mb-16">
          <p className="fs-13">{register.notes}</p>
        </Card>
      )}

      <div className="section-grid-2">
        <ShiftOrdersCard registerId={register.id} />
        <ShiftMovementsCard registerId={register.id} />
      </div>
    </>
  );
}

function ShiftOrdersCard({ registerId }: { registerId: string }) {
  const navigate = useNavigate();
  const q = useOrders({ register_id: registerId });
  const rows = useMemo<Order[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const columns: TableColumn<Order>[] = [
    {
      key: 'number',
      header: '#',
      width: '60px',
      render: (o) => <span className="fw-600 fs-13">#{o.order_number}</span>,
    },
    {
      key: 'time',
      header: 'Time',
      width: '140px',
      render: (o) => (
        <span className="fs-12 text-muted">{formatDateTime(o.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '100px',
      render: (o) => (
        <Badge tone={orderTypeTone(o.order_type)}>
          {o.order_type === 'DINE_IN' ? 'Dine-in' : 'Takeout'}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: '110px',
      render: (o) => (
        <span className="fw-600 fs-13">{formatMoney(Number(o.total))}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (o) => <Badge tone={orderStatusTone(o.status)}>{o.status}</Badge>,
    },
  ];

  return (
    <Card title="Orders in this shift">
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(o) => o.id}
        onRowClick={(o) => navigate(`/orders?id=${o.id}`)}
        isInitialLoad={q.isLoading}
        error={q.error as Error | null}
        emptyMessage="No orders in this shift"
        hasMore={!!q.hasNextPage}
        isLoadingMore={q.isFetchingNextPage}
        onLoadMore={() => q.fetchNextPage()}
      />
    </Card>
  );
}

function ShiftMovementsCard({ registerId }: { registerId: string }) {
  const q = useRegisterCashMovements(registerId);
  const rows = useMemo<CashMovement[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const columns: TableColumn<CashMovement>[] = [
    {
      key: 'time',
      header: 'Time',
      width: '140px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      render: (m) => (
        <Badge tone={cashMovementTypeTone(m.type)}>
          {m.type === 'CASH_IN' ? 'Cash in' : 'Cash out'}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      width: '1fr',
      render: (m) => <span className="fs-13">{m.reason}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '110px',
      render: (m) => {
        const cls = m.type === 'CASH_IN' ? 'text-green' : 'text-red';
        const sign = m.type === 'CASH_IN' ? '+' : '−';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatMoney(Number(m.amount))}
          </span>
        );
      },
    },
  ];

  return (
    <Card title="Cash movements">
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(m) => m.id}
        isInitialLoad={q.isLoading}
        error={q.error as Error | null}
        emptyMessage="No cash movements in this shift"
        hasMore={!!q.hasNextPage}
        isLoadingMore={q.isFetchingNextPage}
        onLoadMore={() => q.fetchNextPage()}
      />
    </Card>
  );
}
