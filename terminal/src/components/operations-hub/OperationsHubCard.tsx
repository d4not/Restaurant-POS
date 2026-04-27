import type { ComponentType, SVGProps } from 'react';

interface OperationsHubCardProps {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  hint?: string;
  disabled?: boolean;
  // Optional message rendered when disabled — used as the title attribute so
  // a hover/long-press surfaces the reason. Visually the card stays muted.
  disabledTitle?: string;
  onClick: () => void;
  // Card accent color for the icon strip — defaults to gold.
  accent?: 'gold' | 'green' | 'red' | 'neutral';
}

const accentColors: Record<NonNullable<OperationsHubCardProps['accent']>, string> = {
  gold: 'var(--gold)',
  green: 'var(--green)',
  red: 'var(--red)',
  neutral: 'var(--text2)',
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '16px 16px 14px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    minHeight: 116,
    cursor: 'pointer',
    transition: 'all 0.12s',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: 'var(--text1)',
  },
  cardDisabled: {
    cursor: 'not-allowed',
    opacity: 0.45,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    marginBottom: 6,
    color: '#2c2420',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1.2,
  },
  hint: {
    fontSize: 12,
    color: 'var(--text2)',
    lineHeight: 1.35,
  },
};

export function OperationsHubCard({
  Icon,
  title,
  hint,
  disabled = false,
  disabledTitle,
  onClick,
  accent = 'gold',
}: OperationsHubCardProps) {
  const accentColor = accentColors[accent];
  return (
    <button
      type="button"
      style={{ ...styles.card, ...(disabled ? styles.cardDisabled : null) }}
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledTitle : undefined}
    >
      <span style={{ ...styles.iconWrap, background: accentColor }}>
        <Icon style={{ fontSize: 20 }} />
      </span>
      <span style={styles.title}>{title}</span>
      {hint && <span style={styles.hint}>{hint}</span>}
    </button>
  );
}
