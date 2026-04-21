import { formatPct } from '../../utils/format';

export interface MiniBarRow {
  label: string;
  value: number;
  /** When present, the bar fills to `value / max`. Otherwise `value` is treated
   *  as already-normalized 0–1 (or 0–100). */
  max?: number;
}

interface MiniBarsProps {
  rows: MiniBarRow[];
  /** How to format the right-hand value. Default: percent of total. */
  formatValue?: (row: MiniBarRow, total: number) => string;
}

export function MiniBars({ rows, formatValue }: MiniBarsProps) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <div className="mini-bars">
      {rows.map((row) => {
        const denom = row.max ?? total;
        const pct = denom > 0 ? (row.value / denom) * 100 : 0;
        const width = Math.max(0, Math.min(100, pct));
        const display = formatValue
          ? formatValue(row, total)
          : formatPct(pct, 0);
        return (
          <div className="mini-bar-row" key={row.label}>
            <div className="mini-label" title={row.label}>{row.label}</div>
            <div className="mini-track">
              <div className="mini-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="mini-val">{display}</div>
          </div>
        );
      })}
    </div>
  );
}
