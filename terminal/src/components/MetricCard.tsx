interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'red';
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 86,
  },
  label: {
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  value: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
    marginTop: 4,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 2,
  },
};

export function MetricCard({ label, value, hint, tone = 'default' }: Props) {
  const valueStyle: React.CSSProperties = {
    ...styles.value,
    color: tone === 'red' ? 'var(--red)' : styles.value.color,
  };
  return (
    <div style={styles.card}>
      <span style={styles.label}>{label}</span>
      <span style={valueStyle}>{value}</span>
      {hint && <span style={styles.hint}>{hint}</span>}
    </div>
  );
}
