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
import { usePayroll } from '../../hooks/usePayroll';
import {
  useUpsertScheduleDay,
  useClearScheduleDay,
  useWeeklySchedule,
} from '../../hooks/useSchedule';
import type {
  Attendance,
  AttendanceStatus,
  Employee,
  PayrollPeriod,
  PayrollStatus,
} from '../../types/staff';
import { attendanceStatusLabel } from '../../types/staff';
import type { ScheduleSlot } from '../../types/people';
import { formatDate, formatMoney } from '../../utils/format';
import {
  addDaysUtc,
  daysOfWeekUtc,
  isFutureDay,
  mondayOfWeekUtc,
  sameUtcDay,
  utcDateKey,
} from '../../utils/week';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';
import { AttendanceDayModal } from '../staff/AttendanceDayModal';
import { EmployeeFormModal } from '../staff/EmployeeFormModal';
import { EmployeeAvatar } from '../../components/people/EmployeeAvatar';
import { SlotEditorPopover } from '../../components/people/SlotEditorPopover';

type Tab = 'profile' | 'schedule' | 'attendance' | 'payroll';

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

function statusBadgeTone(status: AttendanceStatus, isPaid: boolean) {
  switch (status) {
    case 'PRESENT': return 'green' as const;
    case 'LATE':    return 'gold' as const;
    case 'DAY_OFF': return 'gray' as const;
    case 'ABSENT':  return isPaid ? 'gold' as const : 'red' as const;
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

export function EmployeeDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const role = useAuthStore((s) => s.user?.role);
  const canEditSchedule = role === 'MANAGER' || role === 'ADMIN';

  const employeeQ = useEmployee(id);
  const employee = employeeQ.data;

  const [tab, setTab] = useState<Tab>('profile');
  const [weekAnchor, setWeekAnchor] = useState<Date>(() =>
    mondayOfWeekUtc(new Date()),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [dayModal, setDayModal] = useState<{ date: string; existing?: Attendance } | null>(null);

  // Schedule editor state
  const [slotEditor, setSlotEditor] = useState<{
    anchor: HTMLElement;
    dayOfWeek: number;
    slot: ScheduleSlot | null;
  } | null>(null);

  if (employeeQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        {t('common.loading')}…
      </div>
    );
  }

  if (employeeQ.error || !employee) {
    return (
      <Card>
        <EmptyState
          icon="⚠"
          message={t('error.failedLoad')}
          sub={(employeeQ.error as Error | null)?.message ?? '—'}
          action={
            <Button variant="secondary" onClick={() => navigate('/people/employees')}>
              {t('common.back')}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      {/* ─────────── Header bar ─────────── */}
      <div className="flex-between mb-12">
        <Button variant="ghost" onClick={() => navigate('/people/employees')}>
          ← {t('nav.employees')}
        </Button>
        <Button variant="secondary" onClick={() => setEditOpen(true)}>
          {t('common.edit')}
        </Button>
      </div>

      <ProfileHeader employee={employee} />

      {/* ─────────── Tabs ─────────── */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 16,
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
          {t('employees.tabProfile')}
        </TabButton>
        <TabButton active={tab === 'schedule'} onClick={() => setTab('schedule')}>
          {t('nav.schedule')}
        </TabButton>
        <TabButton active={tab === 'attendance'} onClick={() => setTab('attendance')}>
          {t('employees.tabAttendance')}
        </TabButton>
        <TabButton active={tab === 'payroll'} onClick={() => setTab('payroll')}>
          {t('employees.tabPayroll')}
        </TabButton>
      </div>

      {tab === 'profile' && <ProfileTab employee={employee} />}

      {tab === 'schedule' && id && (
        <ScheduleTab
          userId={id}
          canEdit={canEditSchedule}
          onCellClick={(payload, target) =>
            setSlotEditor({
              anchor: target,
              dayOfWeek: payload.dayOfWeek,
              slot: payload.slot,
            })
          }
        />
      )}

      {tab === 'attendance' && id && (
        <AttendanceTab
          userId={id}
          weekAnchor={weekAnchor}
          setWeekAnchor={setWeekAnchor}
          onDayClick={(date, existing) => setDayModal({ date, existing })}
        />
      )}

      {tab === 'payroll' && id && (
        <PayrollHistoryTab userId={id} onOpen={(p) => navigate(`/people/payroll/${p.id}`)} />
      )}

      {/* ─────────── Modals / Popovers ─────────── */}
      <EmployeeFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        employee={employee}
      />

      {id && dayModal && (
        <AttendanceDayModal
          open={!!dayModal}
          onClose={() => setDayModal(null)}
          userId={id}
          date={dayModal.date}
          existing={dayModal.existing}
        />
      )}

      {id && slotEditor && (
        <SlotEditorWrapper
          userId={id}
          dayOfWeek={slotEditor.dayOfWeek}
          slot={slotEditor.slot}
          anchorEl={slotEditor.anchor}
          onClose={() => setSlotEditor(null)}
        />
      )}
    </>
  );
}

/* ─────────────────── Header ─────────────────── */

function ProfileHeader({ employee }: { employee: Employee }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
          <EmployeeAvatar name={employee.name} role={employee.role} size={56} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22, marginBottom: 4 }}>{employee.name}</h2>
            <div className="fs-12 text-muted">
              {employee.position ?? '—'}
              {employee.email && <> · {employee.email}</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge tone={employee.active ? 'green' : 'gray'}>
            {employee.active ? t('common.active') : t('common.inactive')}
          </Badge>
          <Badge tone="gold">{employee.role}</Badge>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────── Tab nav ─────────────────── */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 16px',
        borderRadius: '6px 6px 0 0',
        background: active ? 'var(--surface)' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
        marginBottom: -1,
        color: active ? 'var(--text)' : 'var(--text2)',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'color 0.12s',
      }}
    >
      {children}
    </button>
  );
}

/* ─────────────────── Profile tab ─────────────────── */

function ProfileTab({ employee }: { employee: Employee }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="kpi-grid">
        <KPICard
          label={t('employees.weeklySalary')}
          value={
            employee.weekly_salary
              ? formatMoney(Number(employee.weekly_salary))
              : '—'
          }
        />
        <KPICard
          label={t('employees.hireDate')}
          value={employee.hire_date ? formatDate(employee.hire_date) : '—'}
        />
        <KPICard label={t('common.phone')} value={employee.phone ?? '—'} />
        <KPICard
          label={t('employees.emergencyContact')}
          value={employee.emergency_contact ?? '—'}
        />
      </div>
      {employee.notes && (
        <p className="fs-12 text-muted mt-16">
          <span className="fw-600">{t('common.notes')} · </span>
          {employee.notes}
        </p>
      )}
    </Card>
  );
}

/* ─────────────────── Schedule tab ─────────────────── */

function ScheduleTab({
  userId,
  canEdit,
  onCellClick,
}: {
  userId: string;
  canEdit: boolean;
  onCellClick: (
    payload: { dayOfWeek: number; slot: ScheduleSlot | null },
    target: HTMLElement,
  ) => void;
}) {
  const { t } = useTranslation();
  const q = useWeeklySchedule(userId);
  const week = q.data;

  return (
    <Card title={t('people.schedule.title')} actions={
      <span className="fs-12 text-muted">{t('people.schedule.subtitle')}</span>
    }>
      {q.isLoading && (
        <div className="loading-block">
          <span className="spinner" />
          {t('common.loading')}…
        </div>
      )}
      {!q.isLoading && (
        <div
          onClick={(e) => {
            // Pass the actual button target as the popover anchor.
            const target = (e.target as HTMLElement).closest('button');
            if (!target || !target.dataset.day) return;
            const day = Number(target.dataset.day);
            const slot = week?.[day] ?? null;
            onCellClick({ dayOfWeek: day, slot }, target);
          }}
        >
          <ScheduleGridWithDataAttr week={week} readOnly={!canEdit} />
        </div>
      )}
    </Card>
  );
}

function ScheduleGridWithDataAttr({
  week,
  readOnly,
}: {
  week: import('../../types/people').Week | undefined;
  readOnly: boolean;
}) {
  return <ScheduleGridWithDay week={week} readOnly={readOnly} />;
}

function ScheduleGridWithDay({
  week,
  readOnly,
}: {
  week: import('../../types/people').Week | undefined;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const safeWeek = week ?? Array(7).fill(null);
  const DAY_KEYS = [
    'people.schedule.dayMon',
    'people.schedule.dayTue',
    'people.schedule.dayWed',
    'people.schedule.dayThu',
    'people.schedule.dayFri',
    'people.schedule.daySat',
    'people.schedule.daySun',
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 8,
      }}
    >
      {DAY_KEYS.map((k) => (
        <div
          key={k}
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text3)',
            padding: '0 4px 8px',
            textAlign: 'center',
          }}
        >
          {t(k)}
        </div>
      ))}
      {Array.from({ length: 7 }).map((_, day) => {
        const slot = safeWeek[day] ?? null;
        return (
          <button
            key={day}
            type="button"
            data-day={day}
            disabled={readOnly}
            style={{
              borderRadius: 'var(--radius-sm)',
              background: slot
                ? slot.active
                  ? 'var(--gold-bg)'
                  : 'rgba(154,124,90,0.10)'
                : 'var(--bg)',
              border: slot
                ? `1px ${slot.active ? 'solid' : 'solid'} ${slot.active ? 'var(--gold)' : 'var(--border2)'}`
                : '1px dashed var(--border)',
              padding: '10px 12px',
              minHeight: 64,
              fontSize: 12,
              cursor: readOnly ? 'default' : 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 3,
              fontFamily: 'inherit',
              color: slot
                ? slot.active
                  ? 'var(--text)'
                  : 'var(--text3)'
                : 'var(--text3)',
              textDecoration: slot && !slot.active ? 'line-through' : 'none',
            }}
          >
            {slot ? (
              <>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {formatMinutesAsTime(slot.start_minutes)} – {formatMinutesAsTime(slot.end_minutes)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {Math.round((slot.end_minutes - slot.start_minutes) / 6) / 10}h
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11 }}>
                {readOnly ? '—' : `+ ${t('people.schedule.addSlot')}`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatMinutesAsTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function SlotEditorWrapper({
  userId,
  dayOfWeek,
  slot,
  anchorEl,
  onClose,
}: {
  userId: string;
  dayOfWeek: number;
  slot: ScheduleSlot | null;
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const upsertM = useUpsertScheduleDay();
  const clearM = useClearScheduleDay();
  return (
    <SlotEditorPopover
      open
      anchorEl={anchorEl}
      initial={slot}
      onSave={(start, end) => {
        void upsertM.mutateAsync({
          userId,
          dayOfWeek,
          input: { start_minutes: start, end_minutes: end, active: true },
        });
      }}
      onClear={() => {
        void clearM.mutateAsync({ userId, dayOfWeek });
      }}
      onClose={onClose}
    />
  );
}

/* ─────────────────── Attendance tab ─────────────────── */

function AttendanceTab({
  userId,
  weekAnchor,
  setWeekAnchor,
  onDayClick,
}: {
  userId: string;
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  onDayClick: (date: string, existing?: Attendance) => void;
}) {
  const { t } = useTranslation();
  const weekDays = useMemo(() => daysOfWeekUtc(weekAnchor), [weekAnchor]);
  const weekStartKey = utcDateKey(weekAnchor);
  const weekEndKey = utcDateKey(addDaysUtc(weekAnchor, 6));

  const attendanceQ = useAttendance(
    { user_id: userId, from: weekStartKey, to: weekEndKey },
    { enabled: !!userId },
  );
  const byDate = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const row of attendanceQ.data?.items ?? []) {
      map.set(utcDateKey(new Date(row.date)), row);
    }
    return map;
  }, [attendanceQ.data]);

  return (
    <Card
      title={t('people.attendance.title')}
      actions={
        <div className="week-nav" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setWeekAnchor(addDaysUtc(weekAnchor, -7))}
          >
            ←
          </Button>
          <div className="fs-12 text-muted" style={{ minWidth: 160, textAlign: 'center' }}>
            {formatDate(weekDays[0]!)} – {formatDate(weekDays[6]!)}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setWeekAnchor(addDaysUtc(weekAnchor, 7))}
          >
            →
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setWeekAnchor(mondayOfWeekUtc(new Date()))}
          >
            {t('dateRange.today')}
          </Button>
        </div>
      }
    >
      {attendanceQ.isLoading && (
        <div className="loading-block">
          <span className="spinner" />
          {t('common.loading')}…
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
                  onDayClick(key, row);
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
                      ? t('employees.unpaidAbsence')
                      : row.status === 'ABSENT' && row.is_paid
                        ? t('employees.paidAbsence')
                        : attendanceStatusLabel(row.status)}
                  </Badge>
                ) : (
                  <span className="fs-11 text-muted">
                    {future ? '—' : t('people.attendance.notLogged')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────── Payroll history tab ─────────────────── */

function PayrollHistoryTab({
  userId,
  onOpen,
}: {
  userId: string;
  onOpen: (p: PayrollPeriod) => void;
}) {
  const { t } = useTranslation();
  const payrollQ = usePayroll({ user_id: userId });
  const rows = useMemo<PayrollPeriod[]>(
    () => payrollQ.data?.pages.flatMap((p) => p.items) ?? [],
    [payrollQ.data],
  );

  const columns: TableColumn<PayrollPeriod>[] = [
    {
      key: 'week',
      header: t('people.payroll.colWeek'),
      width: '1fr',
      render: (p) => (
        <span className="fw-600 fs-13">
          {formatDate(p.week_start)} – {formatDate(p.week_end)}
        </span>
      ),
    },
    {
      key: 'worked',
      header: t('people.payroll.daysWorked'),
      width: '90px',
      render: (p) => (
        <span className="fs-13">
          {p.days_worked}/{p.days_expected}
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('people.payroll.colGross'),
      width: '110px',
      render: (p) => (
        <span className="fs-13">{formatMoney(Number(p.gross_pay))}</span>
      ),
    },
    {
      key: 'net',
      header: t('people.payroll.colNet'),
      width: '120px',
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
    <Table
      columns={columns}
      rows={rows}
      getRowKey={(p) => p.id}
      onRowClick={onOpen}
      isInitialLoad={payrollQ.isLoading}
      error={payrollQ.error as Error | null}
      emptyMessage={t('people.payroll.empty')}
      hasMore={!!payrollQ.hasNextPage}
      isLoadingMore={payrollQ.isFetchingNextPage}
      onLoadMore={() => payrollQ.fetchNextPage()}
    />
  );
}
