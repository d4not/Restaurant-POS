import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KPICard,
  Table,
} from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { useEmployee } from '../../hooks/useEmployees';
import { useAttendance } from '../../hooks/useAttendance';
import {
  useGeneratePayroll,
  usePayroll,
} from '../../hooks/usePayroll';
import type {
  Attendance,
  AttendanceStatus,
  Employee,
  PayrollPeriod,
  PayrollStatus,
} from '../../types/staff';
import { attendanceStatusLabel, payrollStatusLabel } from '../../types/staff';
import { formatDate, formatMoney } from '../../utils/format';
import {
  addDaysUtc,
  daysOfWeekUtc,
  isFutureDay,
  mondayOfWeekUtc,
  sameUtcDay,
  utcDateKey,
} from '../../utils/week';
import { AttendanceDayModal } from './AttendanceDayModal';
import { EmployeeFormModal } from './EmployeeFormModal';
import { PayrollDetailModal } from './PayrollDetailModal';

function roleLabel(role: Employee['role']): string {
  switch (role) {
    case 'ADMIN':   return 'Administrator';
    case 'MANAGER': return 'Manager';
    case 'CASHIER': return 'Cashier';
    case 'BARISTA': return 'Barista';
    case 'WAITER':  return 'Waiter';
  }
}

function payrollStatusTone(s: PayrollStatus) {
  switch (s) {
    case 'DRAFT':    return 'gold' as const;
    case 'APPROVED': return 'blue' as const;
    case 'PAID':     return 'green' as const;
  }
}

function dayCellClass(row: Attendance | undefined, date: Date) {
  const today = new Date();
  const classes: string[] = [];
  if (isFutureDay(date, today)) classes.push('future');
  if (sameUtcDay(date, today)) classes.push('today');
  if (!row) return classes.join(' ');
  switch (row.status) {
    case 'PRESENT': classes.push('status-present'); break;
    case 'LATE':    classes.push('status-late'); break;
    case 'DAY_OFF': classes.push('status-day-off'); break;
    case 'ABSENT':
      classes.push(row.is_paid ? 'status-absent-paid' : 'status-absent');
      break;
  }
  return classes.join(' ');
}

function statusBadgeTone(status: AttendanceStatus, isPaid: boolean) {
  switch (status) {
    case 'PRESENT': return 'green' as const;
    case 'LATE':    return 'gold' as const;
    case 'DAY_OFF': return 'gray' as const;
    case 'ABSENT':  return isPaid ? 'gold' as const : 'red' as const;
  }
}

export function EmployeeDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const employeeQ = useEmployee(id);
  const employee = employeeQ.data;

  const [weekAnchor, setWeekAnchor] = useState<Date>(() =>
    mondayOfWeekUtc(new Date()),
  );
  const [dayModal, setDayModal] = useState<{ date: string; existing?: Attendance } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payrollId, setPayrollId] = useState<string | null>(null);

  // ────────── Attendance for the visible week ──────────
  const weekDays = useMemo(() => daysOfWeekUtc(weekAnchor), [weekAnchor]);
  const weekStartKey = utcDateKey(weekAnchor);
  const weekEndKey = utcDateKey(addDaysUtc(weekAnchor, 6));

  const attendanceQ = useAttendance(
    { user_id: id, from: weekStartKey, to: weekEndKey },
    { enabled: !!id },
  );
  const byDate = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const row of attendanceQ.data?.items ?? []) {
      map.set(utcDateKey(new Date(row.date)), row);
    }
    return map;
  }, [attendanceQ.data]);

  // ────────── Payroll history ──────────
  const payrollQ = usePayroll({ user_id: id }, { enabled: !!id });
  const payrollRows = useMemo<PayrollPeriod[]>(
    () => payrollQ.data?.pages.flatMap((p) => p.items) ?? [],
    [payrollQ.data],
  );

  // The "current" payroll is the one whose week_start matches this week.
  const currentPayroll = payrollRows.find(
    (p) => utcDateKey(new Date(p.week_start)) === weekStartKey,
  );

  const generateM = useGeneratePayroll();

  const generateCurrent = async () => {
    await generateM.mutateAsync({ week_start: weekStartKey });
  };

  const payrollColumns: TableColumn<PayrollPeriod>[] = [
    {
      key: 'week',
      header: 'Week',
      width: '1fr',
      render: (p) => (
        <span className="fw-600 fs-13">
          {formatDate(p.week_start)} – {formatDate(p.week_end)}
        </span>
      ),
    },
    {
      key: 'worked',
      header: 'Worked',
      width: '90px',
      render: (p) => (
        <span className="fs-13">
          {p.days_worked}/{p.days_expected}
        </span>
      ),
    },
    {
      key: 'absences',
      header: 'Absences',
      width: '110px',
      render: (p) => (
        <span className="fs-13">
          {p.days_absent}{' '}
          <span className="fs-11 text-muted">
            ({p.paid_absences} paid · {p.unpaid_absences} unpaid)
          </span>
        </span>
      ),
    },
    {
      key: 'gross',
      header: 'Gross',
      width: '110px',
      render: (p) => (
        <span className="fs-13">{formatMoney(Number(p.gross_pay))}</span>
      ),
    },
    {
      key: 'net',
      header: 'Net pay',
      width: '120px',
      render: (p) => (
        <span className="fw-600 fs-13 text-gold">
          {formatMoney(Number(p.net_pay))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (p) => (
        <Badge tone={payrollStatusTone(p.status)}>
          {payrollStatusLabel(p.status)}
        </Badge>
      ),
    },
  ];

  if (employeeQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading employee…
      </div>
    );
  }

  if (employeeQ.error || !employee) {
    return (
      <Card>
        <EmptyState
          icon="⚠"
          message="Couldn't load employee"
          sub={(employeeQ.error as Error | null)?.message ?? 'Not found.'}
          action={
            <Button variant="secondary" onClick={() => navigate('/staff/employees')}>
              Back to employees
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <div className="flex-between mb-12">
        <Button variant="ghost" onClick={() => navigate('/staff/employees')}>
          ← All employees
        </Button>
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </div>

      {/* ─────────── Profile header ─────────── */}
      <Card>
        <div className="flex-between mb-16">
          <div>
            <h2 style={{ fontSize: 22 }}>{employee.name}</h2>
            <div className="fs-12 text-muted mt-4">
              {employee.position ?? '—'}
              {employee.email && <> · {employee.email}</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Badge tone={employee.active ? 'green' : 'gray'}>
              {employee.active ? 'Active' : 'Inactive'}
            </Badge>
            <Badge tone="gold">{roleLabel(employee.role)}</Badge>
          </div>
        </div>
        <div className="employee-header-grid">
          <KPICard
            label="Weekly salary"
            value={employee.weekly_salary ? formatMoney(Number(employee.weekly_salary)) : '—'}
          />
          <KPICard
            label="Hired"
            value={employee.hire_date ? formatDate(employee.hire_date) : '—'}
          />
          <KPICard
            label="Phone"
            value={employee.phone ?? '—'}
          />
          <KPICard
            label="Emergency contact"
            value={employee.emergency_contact ?? '—'}
          />
        </div>
        {employee.notes && (
          <p className="fs-12 text-muted mt-16">
            <span className="fw-600">Notes · </span>
            {employee.notes}
          </p>
        )}
      </Card>

      {/* ─────────── Attendance ─────────── */}
      <div className="mt-16">
        <Card
          title="Attendance"
          actions={
            <div className="week-nav">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setWeekAnchor((w) => addDaysUtc(w, -7))}
              >
                ← Prev
              </Button>
              <div className="week-range">
                {formatDate(weekDays[0]!)} – {formatDate(weekDays[6]!)}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setWeekAnchor((w) => addDaysUtc(w, 7))}
              >
                Next →
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setWeekAnchor(mondayOfWeekUtc(new Date()))}
              >
                This week
              </Button>
            </div>
          }
        >
          {attendanceQ.isLoading && (
            <div className="loading-block">
              <span className="spinner" />
              Loading week…
            </div>
          )}
          {!attendanceQ.isLoading && (
            <div className="attendance-week">
              {weekDays.map((day) => {
                const key = utcDateKey(day);
                const row = byDate.get(key);
                const future = isFutureDay(day);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`day-cell ${dayCellClass(row, day)}`}
                    onClick={() => {
                      if (future) return;
                      setDayModal({ date: key, existing: row });
                    }}
                    disabled={future}
                  >
                    <div className="day-head">
                      {day.toLocaleDateString('en-US', {
                        weekday: 'short',
                        timeZone: 'UTC',
                      })}
                    </div>
                    <div className="day-num">{day.getUTCDate()}</div>
                    {row ? (
                      <Badge tone={statusBadgeTone(row.status, row.is_paid)}>
                        {row.status === 'ABSENT' && !row.is_paid
                          ? 'Absent (unpaid)'
                          : row.status === 'ABSENT' && row.is_paid
                          ? 'Absent (paid)'
                          : attendanceStatusLabel(row.status)}
                      </Badge>
                    ) : (
                      <span className="fs-11 text-muted">
                        {future ? '—' : 'Not logged'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ─────────── Current-week payroll summary ─────────── */}
      <div className="mt-16">
        {currentPayroll ? (
          <Card
            title={`Payroll · week of ${formatDate(currentPayroll.week_start)}`}
            actions={
              <div style={{ display: 'flex', gap: 8 }}>
                <Badge tone={payrollStatusTone(currentPayroll.status)}>
                  {payrollStatusLabel(currentPayroll.status)}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPayrollId(currentPayroll.id)}
                >
                  Open
                </Button>
              </div>
            }
          >
            <div className="employee-header-grid">
              <KPICard
                label="Worked / expected"
                value={`${currentPayroll.days_worked} / ${currentPayroll.days_expected}`}
              />
              <KPICard
                label="Paid absences"
                value={currentPayroll.paid_absences}
              />
              <KPICard
                label="Unpaid absences"
                value={currentPayroll.unpaid_absences}
                valueColor={currentPayroll.unpaid_absences > 0 ? 'red' : 'default'}
              />
              <KPICard
                label="Net pay"
                value={formatMoney(Number(currentPayroll.net_pay))}
                valueColor="gold"
              />
            </div>
          </Card>
        ) : (
          <Card title={`Payroll · week of ${formatDate(weekAnchor)}`}>
            <EmptyState
              icon="◈"
              message="No payroll generated for this week yet"
              sub="Generating a payroll snapshots the attendance breakdown and computes pay."
              action={
                <Button
                  variant="primary"
                  onClick={generateCurrent}
                  loading={generateM.isPending}
                  disabled={!employee.weekly_salary || !employee.active}
                >
                  Generate payroll for this week
                </Button>
              }
            />
            {!employee.weekly_salary && (
              <p className="fs-12 text-muted" style={{ textAlign: 'center' }}>
                This employee has no weekly salary — set one before generating payroll.
              </p>
            )}
          </Card>
        )}
      </div>

      {/* ─────────── Payroll history ─────────── */}
      <div className="mt-16">
        <div className="flex-between mb-12">
          <h2>Payroll history</h2>
        </div>
        <Table
          columns={payrollColumns}
          rows={payrollRows}
          getRowKey={(p) => p.id}
          onRowClick={(p) => setPayrollId(p.id)}
          isInitialLoad={payrollQ.isLoading}
          error={payrollQ.error as Error | null}
          emptyMessage="No payroll periods yet"
          emptySub="Generate one for the current week above."
          hasMore={!!payrollQ.hasNextPage}
          isLoadingMore={payrollQ.isFetchingNextPage}
          onLoadMore={() => payrollQ.fetchNextPage()}
        />
      </div>

      {id && dayModal && (
        <AttendanceDayModal
          open={!!dayModal}
          onClose={() => setDayModal(null)}
          userId={id}
          date={dayModal.date}
          existing={dayModal.existing}
        />
      )}

      <EmployeeFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        employee={employee}
      />

      <PayrollDetailModal
        open={!!payrollId}
        onClose={() => setPayrollId(null)}
        payrollId={payrollId}
      />
    </>
  );
}
