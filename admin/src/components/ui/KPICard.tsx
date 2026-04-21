import type { ReactNode } from 'react';

interface KPICardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
  valueColor?: 'default' | 'green' | 'red' | 'gold';
}

export function KPICard({ label, value, sub, accent, valueColor = 'default' }: KPICardProps) {
  const valueStyle =
    valueColor === 'green' ? { color: 'var(--green)' } :
    valueColor === 'red'   ? { color: 'var(--red)' } :
    valueColor === 'gold'  ? { color: 'var(--gold)' } :
    undefined;

  return (
    <div className={`kpi${accent ? ' accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={valueStyle}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
