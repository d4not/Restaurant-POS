import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../utils/format';

export interface IncomeExpenseDatum {
  label: string;
  income: number;
  expenses: number;
  profit: number;
}

interface IncomeExpenseChartProps {
  data: IncomeExpenseDatum[];
  height?: number;
}

/**
 * Triple-bar chart matching the mockup: income (gold), expenses (muted),
 * profit (green). All three are rendered per-period side-by-side.
 */
export function IncomeExpenseChart({ data, height = 220 }: IncomeExpenseChartProps) {
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
        <YAxis
          stroke="var(--text3)"
          tick={{ fontSize: 11, fill: 'var(--text2)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          tickFormatter={(v) => formatMoney(Number(v))}
          width={80}
        />
        <Tooltip
          cursor={{ fill: 'var(--gold-bg)' }}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text)',
          }}
          formatter={(v, name) => {
            const key = String(name);
            const label =
              key === 'income' ? 'Income' : key === 'expenses' ? 'Expenses' : 'Profit';
            return [formatMoney(Number(v)), label];
          }}
        />
        <Legend
          iconType="square"
          wrapperStyle={{ fontSize: 11, color: 'var(--text2)', paddingTop: 8 }}
        />
        <Bar dataKey="income"   name="Income"   fill="var(--gold)"      radius={[3, 3, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="var(--border2)"   radius={[3, 3, 0, 0]} />
        <Bar dataKey="profit"   name="Profit"   fill="var(--green)"     radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
