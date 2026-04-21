import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  message: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = '✦', message, sub, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="icon">{icon}</div>
      <div className="msg">{message}</div>
      {sub && <div className="sub">{sub}</div>}
      {action && <div className="mt-12">{action}</div>}
    </div>
  );
}
