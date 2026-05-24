import { useTranslation } from '../../i18n';
import { daysAgoYMD, todayYMD } from '../../pages/reports/date-range';

export interface DateRangeValue {
  /** YYYY-MM-DD */ from: string;
  /** YYYY-MM-DD */ to: string;
}

export type DateRangePresetKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth';

interface Preset {
  key: DateRangePresetKey;
  label: string;
  range: () => DateRangeValue;
}

function startOfMonthYMD(d: Date): string {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}
function endOfMonthYMD(d: Date): string {
  // Day 0 of next month = last day of this month.
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildPresets(t: (k: string) => string): Preset[] {
  return [
    {
      key: 'today',
      label: t('dateRange.today'),
      range: () => ({ from: todayYMD(), to: todayYMD() }),
    },
    {
      key: 'yesterday',
      label: t('dateRange.yesterday'),
      range: () => ({ from: daysAgoYMD(1), to: daysAgoYMD(1) }),
    },
    {
      key: 'last7',
      label: t('dateRange.last7'),
      range: () => ({ from: daysAgoYMD(6), to: todayYMD() }),
    },
    {
      key: 'last30',
      label: t('dateRange.last30'),
      range: () => ({ from: daysAgoYMD(29), to: todayYMD() }),
    },
    {
      key: 'last90',
      label: t('dateRange.last90'),
      range: () => ({ from: daysAgoYMD(89), to: todayYMD() }),
    },
    {
      key: 'thisMonth',
      label: t('dateRange.thisMonth'),
      range: () => {
        const now = new Date();
        return { from: startOfMonthYMD(now), to: todayYMD() };
      },
    },
    {
      key: 'lastMonth',
      label: t('dateRange.lastMonth'),
      range: () => {
        const last = new Date();
        last.setDate(1);
        last.setMonth(last.getMonth() - 1);
        return {
          from: startOfMonthYMD(last),
          to: endOfMonthYMD(last),
        };
      },
    },
  ];
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Subset of presets to expose. Default: all. */
  presets?: DateRangePresetKey[];
  /** Optional slot rendered to the right of the controls (e.g. CSV export). */
  rightSlot?: React.ReactNode;
}

/**
 * Date range picker with quick-preset pills. Renders inline as a `.toolbar`
 * row so it can be dropped at the top of any report page.
 */
export function DateRangeFilter({
  value,
  onChange,
  presets,
  rightSlot,
}: DateRangeFilterProps) {
  const { t } = useTranslation();
  const all = buildPresets(t);
  const visible = presets
    ? all.filter((p) => presets.includes(p.key))
    : all;
  const activeKey = matchPreset(value, all);

  return (
    <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
      <div style={{ flex: '0 0 170px' }}>
        <label
          className="fs-11 text-muted"
          style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
        >
          {t('common.from')}
        </label>
        <input
          type="date"
          className="search-box"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </div>
      <div style={{ flex: '0 0 170px' }}>
        <label
          className="fs-11 text-muted"
          style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
        >
          {t('common.to')}
        </label>
        <input
          type="date"
          className="search-box"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {visible.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`filter-pill${activeKey === p.key ? ' active' : ''}`}
            onClick={() => onChange(p.range())}
          >
            {p.label}
          </button>
        ))}
      </div>
      {rightSlot && <div style={{ display: 'flex', gap: 6 }}>{rightSlot}</div>}
    </div>
  );
}

function matchPreset(value: DateRangeValue, presets: Preset[]): DateRangePresetKey | null {
  for (const p of presets) {
    const r = p.range();
    if (r.from === value.from && r.to === value.to) return p.key;
  }
  return null;
}

/**
 * Compute the previous period of equal length, so KPIs can show a delta.
 * Example: from=2026-01-08, to=2026-01-14 → prev: 2026-01-01 → 2026-01-07.
 */
export function previousPeriod(value: DateRangeValue): DateRangeValue {
  const fromD = new Date(`${value.from}T00:00:00`);
  const toD = new Date(`${value.to}T00:00:00`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    return value;
  }
  const days = Math.round((toD.getTime() - fromD.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: ymd(prevFrom), to: ymd(prevTo) };
}
