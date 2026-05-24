import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, KPICard } from '../../components/ui';
import { useEmployees } from '../../hooks/useEmployees';
import { useAttendance } from '../../hooks/useAttendance';
import { usePayroll } from '../../hooks/usePayroll';
import { useCurrentTipPool } from '../../hooks/useTips';
import { useTranslation } from '../../i18n';
import { formatMoney } from '../../utils/format';
import {
  addDaysUtc,
  mondayOfWeekUtc,
  utcDateKey,
} from '../../utils/week';

interface Shortcut {
  to: string;
  icon: string;
  titleKey: string;
  subKey: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    to: '/people/employees',
    icon: '👤',
    titleKey: 'people.hub.shortcut.employees',
    subKey: 'people.hub.shortcut.employeesSub',
  },
  {
    to: '/people/schedule',
    icon: '🗓',
    titleKey: 'people.hub.shortcut.schedule',
    subKey: 'people.hub.shortcut.scheduleSub',
  },
  {
    to: '/people/attendance',
    icon: '✓',
    titleKey: 'people.hub.shortcut.attendance',
    subKey: 'people.hub.shortcut.attendanceSub',
  },
  {
    to: '/people/payroll',
    icon: '💸',
    titleKey: 'people.hub.shortcut.payroll',
    subKey: 'people.hub.shortcut.payrollSub',
  },
  {
    to: '/people/tips',
    icon: '🪙',
    titleKey: 'people.hub.shortcut.tips',
    subKey: 'people.hub.shortcut.tipsSub',
  },
];

export function PeopleHub() {
  const { t } = useTranslation();

  // Week window for KPIs
  const week = useMemo(() => {
    const monday = mondayOfWeekUtc(new Date());
    return {
      from: utcDateKey(monday),
      to: utcDateKey(addDaysUtc(monday, 6)),
    };
  }, []);

  const employeesQ = useEmployees({ active: true });
  const activeEmployees = useMemo(
    () => employeesQ.data?.pages.flatMap((p) => p.items).length ?? 0,
    [employeesQ.data],
  );

  const draftPayrollQ = usePayroll({ status: 'DRAFT', from: week.from });
  const draftCount = useMemo(
    () => draftPayrollQ.data?.pages.flatMap((p) => p.items).length ?? 0,
    [draftPayrollQ.data],
  );

  const attendanceQ = useAttendance({
    status: 'ABSENT',
    from: week.from,
    to: week.to,
  });
  const unpaidAbsences = useMemo(
    () =>
      (attendanceQ.data?.items ?? []).filter((row) => !row.is_paid).length,
    [attendanceQ.data],
  );

  const poolQ = useCurrentTipPool();
  const collected = poolQ.data ? Number(poolQ.data.total_collected) : 0;

  return (
    <>
      <Card>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('people.hub.title')}</h1>
        <div className="fs-13 text-muted">{t('people.hub.subtitle')}</div>
      </Card>

      <div className="kpi-grid" style={{ marginTop: 16, marginBottom: 16 }}>
        <KPICard
          label={t('people.hub.kpi.activeEmployees')}
          value={activeEmployees}
        />
        <KPICard
          label={t('people.hub.kpi.currentPool')}
          value={formatMoney(collected)}
          valueColor="gold"
        />
        <KPICard
          label={t('people.hub.kpi.draftPayrolls')}
          value={draftCount}
        />
        <KPICard
          label={t('people.hub.kpi.unpaidAbsences')}
          value={unpaidAbsences}
          valueColor={unpaidAbsences > 0 ? 'red' : 'default'}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        {SHORTCUTS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '20px 22px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.12s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--gold)';
              e.currentTarget.style.boxShadow = 'var(--shadow)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: 'var(--gold-bg)',
                color: 'var(--gold)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              {s.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginBottom: 2,
                }}
              >
                {t(s.titleKey)}
              </div>
              <div className="fs-12 text-muted">{t(s.subKey)}</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
