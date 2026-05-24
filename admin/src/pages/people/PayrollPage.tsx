import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { useGeneratePayroll, usePayroll } from '../../hooks/usePayroll';
import type { PayrollPeriod, PayrollStatus } from '../../types/staff';
import { formatDate, formatMoney } from '../../utils/format';
import { mondayOfWeekUtc, utcDateKey } from '../../utils/week';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';
import { EmployeeAvatar } from '../../components/people/EmployeeAvatar';

function payrollStatusTone(s: PayrollStatus) {
  switch (s) {
    case 'DRAFT':    return 'gold' as const;
    case 'APPROVED': return 'blue' as const;
    case 'PAID':     return 'green' as const;
  }
}

function payrollStatusLabel(s: PayrollStatus, t: (k: string) => string) {
  switch (s) {
    case 'DRAFT':    return t('people.payroll.statusDraft');
    case 'APPROVED': return t('people.payroll.statusApproved');
    case 'PAID':     return t('people.payroll.statusPaid');
  }
}

export function PayrollPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canGenerate = role === 'MANAGER' || role === 'ADMIN';

  const [weekAnchor] = useState<Date>(() => mondayOfWeekUtc(new Date()));
  const weekKey = utcDateKey(weekAnchor);
  const generateM = useGeneratePayroll();

  // List all payrolls, ordered most-recent first
  const q = usePayroll({});
  const rows = useMemo<PayrollPeriod[]>(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  // Subset for the current week's banner
  const thisWeek = useMemo(
    () => rows.filter((p) => utcDateKey(new Date(p.week_start)) === weekKey),
    [rows, weekKey],
  );
  const draftCount = thisWeek.filter((p) => p.status === 'DRAFT').length;
  const totalNet = thisWeek.reduce((sum, p) => sum + Number(p.net_pay), 0);

  const onGenerate = async () => {
    try {
      await generateM.mutateAsync({ week_start: weekKey });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not generate');
    }
  };

  const columns: TableColumn<PayrollPeriod>[] = [
    {
      key: 'employee',
      header: t('people.payroll.colEmployee'),
      width: '1.4fr',
      render: (p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <EmployeeAvatar name={p.user?.name ?? '—'} size={28} />
          <div style={{ minWidth: 0 }}>
            <div className="fw-600 fs-13">{p.user?.name ?? '—'}</div>
            <div className="fs-11 text-muted">{p.user?.position ?? ''}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'week',
      header: t('people.payroll.colWeek'),
      width: '180px',
      render: (p) => (
        <span className="fs-12 text-muted">
          {formatDate(p.week_start)} – {formatDate(p.week_end)}
        </span>
      ),
    },
    {
      key: 'days',
      header: t('people.payroll.daysWorked'),
      width: '110px',
      render: (p) => (
        <span className="fs-13">
          {p.days_worked}/{p.days_expected}
          {p.unpaid_absences > 0 && (
            <span className="fs-11 text-red"> · −{p.unpaid_absences}</span>
          )}
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('people.payroll.colGross'),
      width: '120px',
      render: (p) => (
        <span className="fs-13">{formatMoney(Number(p.gross_pay))}</span>
      ),
    },
    {
      key: 'net',
      header: t('people.payroll.colNet'),
      width: '130px',
      render: (p) => (
        <span className="fw-600 fs-13 text-gold">
          {formatMoney(Number(p.net_pay))}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('people.payroll.colStatus'),
      width: '110px',
      render: (p) => (
        <Badge tone={payrollStatusTone(p.status)}>
          {payrollStatusLabel(p.status, t)}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <Card>
        <div className="flex-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('people.payroll.title')}</h1>
            <div className="fs-13 text-muted">{t('people.payroll.subtitle')}</div>
          </div>
          {canGenerate && (
            <Button
              variant="primary"
              onClick={onGenerate}
              loading={generateM.isPending}
            >
              {t('people.payroll.generate')}
            </Button>
          )}
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="fs-11 text-muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
              {t('people.payroll.weekOf')}
            </div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 18,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {formatDate(weekAnchor)}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div>
            <div className="fs-11 text-muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
              {t('people.payroll.statusDraft')}
            </div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 22,
                fontWeight: 600,
                marginTop: 4,
                color: draftCount > 0 ? 'var(--gold)' : 'var(--text)',
              }}
            >
              {draftCount}
            </div>
          </div>
          <div>
            <div className="fs-11 text-muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
              {t('people.payroll.totalNet')}
            </div>
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 22,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {formatMoney(totalNet)}
            </div>
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          rows={rows}
          getRowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/people/payroll/${p.id}`)}
          isInitialLoad={q.isLoading}
          error={q.error as Error | null}
          emptyMessage={t('people.payroll.empty')}
          hasMore={!!q.hasNextPage}
          isLoadingMore={q.isFetchingNextPage}
          onLoadMore={() => q.fetchNextPage()}
        />
      </div>
    </>
  );
}
