import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../utils/format';

export interface SalesBarDatum {
  label: string;
  value: number;
}

interface SalesBarChartProps {
  data: SalesBarDatum[];
  height?: number;
  /** When true, YAxis is hidden to keep the chart compact. */
  compact?: boolean;
}

export function SalesBarChart({ data, height = 220, compact = false }: SalesBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="var(--text3)"
          tick={{ fontSize: 11, fill: 'var(--text2)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        {!compact && (
          <YAxis
            stroke="var(--text3)"
            tick={{ fontSize: 11, fill: 'var(--text2)' }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={80}
          />
        )}
        <Tooltip
          cursor={{ fill: 'var(--gold-bg)' }}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text)',
          }}
          formatter={(v) => [formatMoney(Number(v)), 'Sales']}
        />
        <Bar dataKey="value" fill="var(--gold)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
