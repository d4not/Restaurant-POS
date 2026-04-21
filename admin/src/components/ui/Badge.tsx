import type { ReactNode } from 'react';

export type BadgeTone = 'green' | 'gold' | 'red' | 'gray' | 'blue';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'gray', className = '', children }: BadgeProps) {
  const classes = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}
