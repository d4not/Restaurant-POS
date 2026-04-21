import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { useAuthStore } from '../../store/auth';
import {
  useCurrentUserRegister,
  useRegisterCashMovements,
  useRegisters,
} from '../../hooks/useRegisters';
import type { CashMovement, CashRegister } from '../../types/operations';
import {
  formatDateTime,
  formatMoney,
} from '../../utils/format';
import {
  cashMovementTypeTone,
  formatElapsed,
  registerStatusTone,
} from './operations-meta';
import { CashMovementModal } from './CashMovementModal';
import { CloseShiftModal } from './CloseShiftModal';
import { OpenShiftModal } from './OpenShiftModal';

export function CashRegistersPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const currentQ = useCurrentUserRegister(user?.id);
  const current = currentQ.data ?? null;

  const historyQ = useRegisters({ status: 'CLOSED' });
  const history = useMemo<CashRegister[]>(
    () => historyQ.data?.pages.flatMap((p) => p.items) ?? [],
    [historyQ.data],
  );

  const [openShiftOpen, setOpenShiftOpen] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);

  const columns: TableColumn<CashRegister>[] = [
    {
      key: 'date',
      header: 'Opened',
      width: '170px',
      render: (r) => (
        <span className="fs-12 text-muted">{formatDateTime(r.opened_at)}</span>
      ),
    },
    {
      key: 'user',
      header: 'User',
      width: '1.2fr',
      render: (r) => (
        <span className="fw-600 fs-13">{r.user?.name ?? '—'}</span>
      ),
    },
    {
      key: 'opening',
      header: 'Opening',
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(Number(r.opening_amount))}</span>
      ),
    },
    {
      key: 'expected',
      header: 'Expected',
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(Number(r.expected_amount))}</span>
      ),
    },
    {
      key: 'actual',
      header: 'Actual',
      width: '120px',
      render: (r) =>
        r.actual_amount == null ? (
          <span className="fs-12 text-muted">—</span>
        ) : (
          <span className="fw-600 fs-13">
            {formatMoney(Number(r.actual_amount))}
          </span>
        ),
    },
    {
      key: 'difference',
      header: 'Difference',
      width: '130px',
      render: (r) => {
        if (r.difference == null) return <span className="fs-12 text-muted">—</span>;
        const diff = Number(r.difference);
        if (diff === 0) {
          return <span className="fw-600 fs-13 text-muted">{formatMoney(0)}</span>;
        }
        const cls = diff > 0 ? 'text-green' : 'text-red';
        const sign = diff > 0 ? '+' : '';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatMoney(diff)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (r) => (
        <Badge tone={registerStatusTone(r.status)}>{r.status}</Badge>
      ),
    },
  ];

  return (
    <>
      <CurrentShiftSection
        register={current}
        loading={currentQ.isLoading}
        onOpen={() => setOpenShiftOpen(true)}
        onClose={() => setCloseShiftOpen(true)}
        onAddMovement={() => setMovementOpen(true)}
      />

      <div className="flex-between mb-12 mt-16">
        <h2>Shift history</h2>
      </div>

      <Table
        columns={columns}
        rows={history}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/staff/cash-registers/${r.id}`)}
        isInitialLoad={historyQ.isLoading}
        error={historyQ.error as Error | null}
        emptyMessage="No closed shifts yet"
        emptySub="Closed shifts will appear here once you close your first cash register."
        hasMore={!!historyQ.hasNextPage}
        isLoadingMore={historyQ.isFetchingNextPage}
        onLoadMore={() => historyQ.fetchNextPage()}
      />

      <OpenShiftModal
        open={openShiftOpen}
        onClose={() => setOpenShiftOpen(false)}
      />
      {current && (
        <>
          <CloseShiftModal
            open={closeShiftOpen}
            onClose={() => setCloseShiftOpen(false)}
            register={current}
          />
          <CashMovementModal
            open={movementOpen}
            onClose={() => setMovementOpen(false)}
            registerId={current.id}
          />
        </>
      )}
    </>
  );
}

/* ── Current-shift section ──────────────────────────────────────────── */

interface CurrentShiftSectionProps {
  register: CashRegister | null;
  loading: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAddMovement: () => void;
}

function CurrentShiftSection({
  register,
  loading,
  onOpen,
  onClose,
  onAddMovement,
}: CurrentShiftSectionProps) {
  if (loading) {
    return (
      <Card>
        <div className="loading-block">
          <span className="spinner" />
          Loading current shift…
        </div>
      </Card>
    );
  }

  if (!register) {
    return (
      <Card>
        <EmptyState
          icon="◈"
          message="No open shift"
          sub="Open a shift to start taking orders and tracking cash movements."
          action={
            <Button variant="primary" onClick={onOpen}>
              Open shift
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Current shift"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onAddMovement}>
              + Cash in / out
            </Button>
            <Button variant="danger" onClick={onClose}>
              Close shift
            </Button>
          </div>
        }
      >
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <KPICard
            accent
            label="Status"
            value={<Badge tone={registerStatusTone(register.status)}>{register.status}</Badge>}
            sub={register.user?.name ? `Opened by ${register.user.name}` : undefined}
          />
          <KPICard
            label="Opening amount"
            value={formatMoney(Number(register.opening_amount))}
            sub={formatDateTime(register.opened_at)}
          />
          <KPICard
            label="Expected in drawer"
            value={formatMoney(Number(register.expected_amount))}
            valueColor="gold"
            sub="Opening + cash sales − change − net cash out"
          />
          <KPICard
            label="Elapsed"
            value={<ElapsedValue from={register.opened_at} />}
            sub="Since shift opened"
          />
        </div>

        {register.notes && (
          <p className="fs-12 text-muted mt-16">
            <span className="fw-600">Notes · </span>
            {register.notes}
          </p>
        )}
      </Card>

      <div className="mt-16">
        <CurrentCashMovementsCard registerId={register.id} />
      </div>
    </>
  );
}

function ElapsedValue({ from }: { from: string }) {
  // Recompute every 30 seconds so the card stays live without refetching.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return <>{formatElapsed(from)}</>;
}

/* ── Cash-movements list card ───────────────────────────────────────── */

function CurrentCashMovementsCard({ registerId }: { registerId: string }) {
  const q = useRegisterCashMovements(registerId);
  const rows = useMemo<CashMovement[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const columns: TableColumn<CashMovement>[] = [
    {
      key: 'date',
      header: 'Time',
      width: '160px',
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
      width: '130px',
      render: (m) => {
        const n = Number(m.amount);
        const cls = m.type === 'CASH_IN' ? 'text-green' : 'text-red';
        const sign = m.type === 'CASH_IN' ? '+' : '−';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatMoney(n)}
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
        emptyMessage="No cash movements recorded yet"
        emptySub="Record cash in or cash out for tips, petty cash, float top-ups, etc."
        hasMore={!!q.hasNextPage}
        isLoadingMore={q.isFetchingNextPage}
        onLoadMore={() => q.fetchNextPage()}
      />
    </Card>
  );
}
