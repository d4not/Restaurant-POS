import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'green' | 'gold' | 'red' | 'gray' | 'blue';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Badge({ tone = 'gray', className = '', style, children }: BadgeProps) {
  const classes = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes} style={style}>{children}</span>;
}
