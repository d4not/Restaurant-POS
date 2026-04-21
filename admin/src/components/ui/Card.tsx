import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  dark?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
}

export function Card({ dark, title, actions, className = '', children, ...rest }: CardProps) {
  const classes = [dark ? 'card-dark' : 'card', className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {(title || actions) && (
        <div className="flex-between mb-16">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
