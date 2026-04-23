import { useEffect, useState } from 'react';
import { Badge, Button, Modal } from '../../components/ui';
import { usePayrollPeriod, useUpdatePayroll } from '../../hooks/usePayroll';
import type { PayrollPeriod, PayrollStatus } from '../../types/staff';
import { attendanceStatusLabel, payrollStatusLabel } from '../../types/staff';
import { amountToCentavos, formatDate, formatMoney } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  payrollId: string | null;
}

function payrollStatusTone(s: PayrollStatus) {
  switch (s) {
    case 'DRAFT':    return 'gold' as const;
    case 'APPROVED': return 'blue' as const;
    case 'PAID':     return 'green' as const;
  }
}

export function PayrollDetailModal({ open, onClose, payrollId }: Props) {
  const q = usePayrollPeriod(payrollId ?? undefined);
  const period = q.data ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        period
          ? `Payroll · week of ${formatDate(period.week_start)}`
          : 'Payroll detail'
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isLoading && (
        <div className="loading-block">
          <span className="spinner" />
          Loading…
        </div>
      )}

      {q.error && (
        <div className="auth-alert">{(q.error as Error).message}</div>
      )}

      {period && <PayrollDetailBody period={period} />}
    </Modal>
  );
}

function PayrollDetailBody({ period }: { period: PayrollPeriod }) {
  const updateM = useUpdatePayroll();
  const [bonusInput, setBonusInput] = useState(
    (Number(period.bonuses) / 100).toFixed(2),
  );
  const [notes, setNotes] = useState(period.notes ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sync when a different period is opened or the parent refetches.
  useEffect(() => {
    setBonusInput((Number(period.bonuses) / 100).toFixed(2));
    setNotes(period.notes ?? '');
    setSaveError(null);
  }, [period.id, period.bonuses, period.notes]);

  const saveDraft = async () => {
    setSaveError(null);
    const bonus = amountToCentavos(bonusInput);
    if (bonus === null) {
      setSaveError('Bonus must be a non-negative number');
      return;
    }
    try {
      await updateM.mutateAsync({
        id: period.id,
        input: { bonuses: bonus, notes: notes.trim() || null },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const transitionTo = async (status: PayrollStatus) => {
    setSaveError(null);
    try {
      await updateM.mutateAsync({ id: period.id, input: { status } });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update status');
    }
  };

  const canEditBonuses = period.status === 'DRAFT';

  return (
    <>
      <div className="detail-grid mb-16">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Employee</div>
            <div className="dv">{period.user?.name ?? '—'}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Status</div>
            <div className="dv">
              <Badge tone={payrollStatusTone(period.status)}>
                {payrollStatusLabel(period.status)}
              </Badge>
            </div>
          </div>
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Week</div>
            <div className="dv">
              {formatDate(period.week_start)} – {formatDate(period.week_end)}
            </div>
          </div>
          <div className="detail-cell">
            <div className="dk">Approver</div>
            <div className="dv">{period.approver?.name ?? '—'}</div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h3>Attendance breakdown</h3>
        <div className="detail-grid">
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Days expected</div>
              <div className="dv">{period.days_expected}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Days worked</div>
              <div className="dv">{period.days_worked}</div>
            </div>
          </div>
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Paid absences</div>
              <div className="dv">{period.paid_absences}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Unpaid absences</div>
              <div className={`dv ${period.unpaid_absences > 0 ? 'red' : ''}`}>
                {period.unpaid_absences}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(period.attendance ?? []).length > 0 && (
        <div className="detail-section">
          <h3>Daily attendance</h3>
          <div className="table-wrap">
            <div
              className="table-head"
              style={{ gridTemplateColumns: '130px 110px 90px 1fr' }}
            >
              <div>Date</div>
              <div>Status</div>
              <div>Paid?</div>
              <div>Reason / notes</div>
            </div>
            {(period.attendance ?? []).map((row, idx) => (
              <div
                key={row.id}
                className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{ gridTemplateColumns: '130px 110px 90px 1fr', cursor: 'default' }}
              >
                <div className="fs-12 text-muted">{formatDate(row.date)}</div>
                <div className="fs-13 fw-600">
                  {attendanceStatusLabel(row.status)}
                </div>
                <div className="fs-12">
                  {row.status === 'ABSENT' ? (row.is_paid ? 'Paid' : 'Unpaid') : '—'}
                </div>
                <div className="fs-12 text-muted">
                  {row.reason ?? row.notes ?? '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>Financials</h3>
        <div className="detail-grid">
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Gross pay</div>
              <div className="dv">{formatMoney(Number(period.gross_pay))}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Deductions</div>
              <div className="dv red">−{formatMoney(Number(period.deductions))}</div>
            </div>
          </div>
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Bonuses</div>
              <div className="dv green">
                {canEditBonuses ? (
                  <div style={{ width: '100%' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={bonusInput}
                      onChange={(e) => setBonusInput(e.target.value)}
                      style={{ width: '100%', border: 'none', background: 'transparent', padding: 0, outline: 'none', color: 'var(--green)', fontWeight: 600 }}
                    />
                  </div>
                ) : (
                  `+${formatMoney(Number(period.bonuses))}`
                )}
              </div>
            </div>
            <div className="detail-cell">
              <div className="dk">Net pay</div>
              <div className="dv gold">{formatMoney(Number(period.net_pay))}</div>
            </div>
          </div>
        </div>
      </div>

      {canEditBonuses && (
        <div className="field">
          <label htmlFor="payroll-notes">Notes</label>
          <textarea
            id="payroll-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </div>
      )}

      {saveError && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {canEditBonuses && (
          <>
            <Button
              variant="secondary"
              onClick={saveDraft}
              loading={updateM.isPending}
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={() => transitionTo('APPROVED')}
              loading={updateM.isPending}
            >
              Approve
            </Button>
          </>
        )}
        {period.status === 'APPROVED' && (
          <Button
            variant="primary"
            onClick={() => transitionTo('PAID')}
            loading={updateM.isPending}
          >
            Mark as paid
          </Button>
        )}
      </div>
    </>
  );
}
