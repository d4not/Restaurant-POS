import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KPICard,
} from '../../components/ui';
import { usePayrollPeriod, useUpdatePayroll } from '../../hooks/usePayroll';
import { attendanceStatusLabel } from '../../types/staff';
import type { PayrollPeriod, PayrollStatus } from '../../types/staff';
import { formatDate, formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';
import { EmployeeAvatar } from '../../components/people/EmployeeAvatar';
import { AdjustmentEditor } from '../../components/people/AdjustmentEditor';

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

export function PayrollDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const role = useAuthStore((s) => s.user?.role);
  const canApprove = role === 'MANAGER' || role === 'ADMIN';

  const q = usePayrollPeriod(id);
  const period = q.data ?? null;

  if (q.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        {t('common.loading')}…
      </div>
    );
  }

  if (q.error || !period) {
    return (
      <Card>
        <EmptyState
          icon="⚠"
          message={t('error.failedLoad')}
          sub={(q.error as Error | null)?.message ?? '—'}
          action={
            <Button variant="secondary" onClick={() => navigate('/people/payroll')}>
              {t('common.back')}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <div className="flex-between mb-12">
        <Button variant="ghost" onClick={() => navigate('/people/payroll')}>
          ← {t('nav.payroll')}
        </Button>
      </div>

      <PayrollHeader period={period} canApprove={canApprove} />

      <div style={{ marginTop: 16 }}>
        <PayrollSummary period={period} />
      </div>

      <div style={{ marginTop: 16 }}>
        <AttendanceStrip period={period} />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card>
          <AdjustmentEditor
            periodId={period.id}
            adjustments={period.adjustments ?? []}
            status={period.status}
          />
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <NotesCard period={period} />
      </div>
    </>
  );
}

/* ─────────────── Header ─────────────── */

function PayrollHeader({
  period,
  canApprove,
}: {
  period: PayrollPeriod;
  canApprove: boolean;
}) {
  const { t } = useTranslation();
  const updateM = useUpdatePayroll();
  const [error, setError] = useState<string | null>(null);

  const transitionTo = async (status: PayrollStatus) => {
    setError(null);
    try {
      await updateM.mutateAsync({ id: period.id, input: { status } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    }
  };

  return (
    <Card>
      <div className="flex-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <EmployeeAvatar name={period.user?.name ?? '—'} size={48} />
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 4 }}>
              {period.user?.name ?? '—'}
            </h1>
            <div className="fs-12 text-muted">
              {t('people.payroll.weekOf')} {formatDate(period.week_start)} ·{' '}
              {formatDate(period.week_start)} – {formatDate(period.week_end)}
            </div>
            {period.approver && (
              <div className="fs-11 text-muted mt-4">
                {t('common.actions')}: {period.approver.name}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge tone={payrollStatusTone(period.status)}>
            {payrollStatusLabel(period.status, t)}
          </Badge>
          {canApprove && period.status === 'DRAFT' && (
            <Button
              variant="primary"
              loading={updateM.isPending}
              onClick={() => transitionTo('APPROVED')}
            >
              {t('people.payroll.approve')}
            </Button>
          )}
          {canApprove && period.status === 'APPROVED' && (
            <Button
              variant="primary"
              loading={updateM.isPending}
              onClick={() => transitionTo('PAID')}
            >
              {t('people.payroll.markPaid')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="auth-alert" style={{ marginTop: 12 }}>{error}</div>
      )}
    </Card>
  );
}

/* ─────────────── Summary grid ─────────────── */

function PayrollSummary({ period }: { period: PayrollPeriod }) {
  const { t } = useTranslation();
  return (
    <div className="kpi-grid">
      <KPICard
        label={t('people.payroll.gross')}
        value={formatMoney(Number(period.gross_pay))}
      />
      <KPICard
        label={t('people.payroll.absenceDeductions')}
        value={`−${formatMoney(Number(period.absence_deductions))}`}
        valueColor={Number(period.absence_deductions) > 0 ? 'red' : 'default'}
      />
      <KPICard
        label={t('people.payroll.tabDeductions')}
        value={`−${formatMoney(Number(period.tab_deductions ?? 0))}`}
        valueColor={Number(period.tab_deductions ?? 0) > 0 ? 'red' : 'default'}
      />
      <KPICard
        label={t('people.payroll.adjustmentBonuses')}
        value={`+${formatMoney(Number(period.adjustment_bonuses))}`}
        valueColor={Number(period.adjustment_bonuses) > 0 ? 'green' : 'default'}
      />
      <KPICard
        label={t('people.payroll.adjustmentDeductions')}
        value={`−${formatMoney(Number(period.adjustment_deductions))}`}
        valueColor={Number(period.adjustment_deductions) > 0 ? 'red' : 'default'}
      />
      <KPICard
        label={t('people.payroll.tips')}
        value={`+${formatMoney(Number(period.tips_amount))}`}
        valueColor={Number(period.tips_amount) > 0 ? 'gold' : 'default'}
      />
      <KPICard
        accent
        label={t('people.payroll.net')}
        value={formatMoney(Number(period.net_pay))}
      />
    </div>
  );
}

/* ─────────────── Attendance breakdown strip ─────────────── */

function AttendanceStrip({ period }: { period: PayrollPeriod }) {
  const { t } = useTranslation();
  const rows = period.attendance ?? [];
  if (rows.length === 0) {
    return (
      <Card title={t('people.attendance.title')}>
        <div className="fs-12 text-muted">{t('common.noResults')}</div>
      </Card>
    );
  }
  return (
    <Card title={t('people.attendance.title')}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {rows.map((row) => {
          const tone =
            row.status === 'PRESENT' ? 'green' :
            row.status === 'LATE'    ? 'gold'  :
            row.status === 'DAY_OFF' ? 'gray'  :
            row.is_paid ? 'gold' : 'red';
          return (
            <div
              key={row.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 10,
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 12,
              }}
            >
              <div className="fs-11 text-muted">{formatDate(row.date)}</div>
              <Badge tone={tone}>
                {row.status === 'ABSENT' && !row.is_paid
                  ? t('employees.unpaidAbsence')
                  : row.status === 'ABSENT' && row.is_paid
                    ? t('employees.paidAbsence')
                    : attendanceStatusLabel(row.status)}
              </Badge>
              {(row.reason || row.notes) && (
                <div className="fs-11 text-muted" style={{ marginTop: 4 }}>
                  {row.reason ?? row.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────────── Notes ─────────────── */

function NotesCard({ period }: { period: PayrollPeriod }) {
  const { t } = useTranslation();
  const updateM = useUpdatePayroll();
  const [notes, setNotes] = useState(period.notes ?? '');
  const [saved, setSaved] = useState(false);
  const editable = period.status === 'DRAFT';

  useEffect(() => {
    setNotes(period.notes ?? '');
  }, [period.id, period.notes]);

  const save = async () => {
    setSaved(false);
    try {
      await updateM.mutateAsync({
        id: period.id,
        input: { notes: notes.trim() || null },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <Card title={t('common.notes')}>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        disabled={!editable}
        style={{
          width: '100%',
          minHeight: 80,
          border: '1px solid var(--border2)',
          borderRadius: 'var(--radius-sm)',
          padding: 10,
          fontSize: 13,
          fontFamily: 'inherit',
          background: editable ? 'var(--bg)' : 'rgba(0,0,0,0.02)',
          resize: 'vertical',
        }}
      />
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          {saved && (
            <span className="fs-12 text-muted" style={{ alignSelf: 'center' }}>
              {t('common.done')} ✓
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={save}
            loading={updateM.isPending}
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
