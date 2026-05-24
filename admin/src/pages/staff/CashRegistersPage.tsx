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
import { useTranslation } from '../../i18n';

export function CashRegistersPage() {
  const { t } = useTranslation();
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
      header: t('cashRegisters.colDate'),
      width: '170px',
      render: (r) => (
        <span className="fs-12 text-muted">{formatDateTime(r.opened_at)}</span>
      ),
    },
    {
      key: 'user',
      header: t('cashRegisters.colUser'),
      width: '1.2fr',
      render: (r) => (
        <span className="fw-600 fs-13">{r.user?.name ?? '—'}</span>
      ),
    },
    {
      key: 'opening',
      header: t('cashRegisters.colOpening'),
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(Number(r.opening_amount))}</span>
      ),
    },
    {
      key: 'expected',
      header: t('cashRegisters.colExpected'),
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(Number(r.expected_amount))}</span>
      ),
    },
    {
      key: 'actual',
      header: t('cashRegisters.colActual'),
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
      header: t('cashRegisters.colDifference'),
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
      header: t('common.status'),
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
        <h2>{t('cashRegisters.title')}</h2>
      </div>

      <Table
        columns={columns}
        rows={history}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/cash/shifts/${r.id}`)}
        isInitialLoad={historyQ.isLoading}
        error={historyQ.error as Error | null}
        emptyMessage={t('cashRegisters.empty')}
        emptySub={t('cashRegisters.subtitle')}
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
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card>
        <div className="loading-block">
          <span className="spinner" />
          {t('common.loading')}…
        </div>
      </Card>
    );
  }

  if (!register) {
    return (
      <Card>
        <EmptyState
          icon="◈"
          message={t('auth.noShift')}
          sub={t('cashRegisters.subtitle')}
          action={
            <Button variant="primary" onClick={onOpen}>
              {t('cashRegisters.openShift')}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title={t('cashRegisters.shiftOf')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onAddMovement}>
              + {t('cashRegisters.movementTitle')}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t('cashRegisters.closeShift')}
            </Button>
          </div>
        }
      >
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <KPICard
            accent
            label={t('common.status')}
            value={<Badge tone={registerStatusTone(register.status)}>{register.status}</Badge>}
            sub={register.user?.name ? `${t('cashRegisters.colUser')}: ${register.user.name}` : undefined}
          />
          <KPICard
            label={t('cashRegisters.openingAmount')}
            value={formatMoney(Number(register.opening_amount))}
            sub={formatDateTime(register.opened_at)}
          />
          <KPICard
            label={t('cashRegisters.colExpected')}
            value={formatMoney(Number(register.expected_amount))}
            valueColor="gold"
          />
          <KPICard
            label={t('common.date')}
            value={<ElapsedValue from={register.opened_at} />}
          />
        </div>

        {register.notes && (
          <p className="fs-12 text-muted mt-16">
            <span className="fw-600">{t('common.notes')} · </span>
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
  const { t } = useTranslation();
  const q = useRegisterCashMovements(registerId);
  const rows = useMemo<CashMovement[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const columns: TableColumn<CashMovement>[] = [
    {
      key: 'date',
      header: t('common.date'),
      width: '160px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: t('common.type'),
      width: '110px',
      render: (m) => (
        <Badge tone={cashMovementTypeTone(m.type)}>
          {m.type === 'CASH_IN' ? t('cashRegisters.cashIn') : t('cashRegisters.cashOut')}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: t('common.notes'),
      width: '1fr',
      render: (m) => <span className="fs-13">{m.reason}</span>,
    },
    {
      key: 'amount',
      header: t('common.amount'),
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
    <Card title={t('cashRegisters.movementTitle')}>
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(m) => m.id}
        isInitialLoad={q.isLoading}
        error={q.error as Error | null}
        emptyMessage={t('common.noResults')}
        hasMore={!!q.hasNextPage}
        isLoadingMore={q.isFetchingNextPage}
        onLoadMore={() => q.fetchNextPage()}
      />
    </Card>
  );
}
