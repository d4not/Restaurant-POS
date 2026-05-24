import type { CSSProperties } from 'react';
import type { UserRole } from '../../types/api';
import { initials } from '../../utils/format';

interface Props {
  name: string;
  role?: UserRole;
  size?: number;
}

function ringColor(role?: UserRole): string {
  switch (role) {
    case 'CASHIER': return 'var(--gold)';
    case 'BARISTA': return 'var(--green)';
    case 'WAITER':  return 'var(--blue)';
    case 'MANAGER': return 'var(--red)';
    case 'ADMIN':   return 'var(--text)';
    default:        return 'var(--border2)';
  }
}

export function EmployeeAvatar({ name, role, size = 36 }: Props) {
  const fontSize = Math.max(10, Math.round(size * 0.36));
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'var(--sidebar2)',
    color: '#f0e0c0',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontWeight: 700,
    fontSize,
    border: `2px solid ${ringColor(role)}`,
    boxShadow: '0 1px 2px rgba(30,17,8,0.10)',
    flexShrink: 0,
    letterSpacing: 0.5,
  };
  return (
    <span style={style} title={role ? `${name} · ${role}` : name}>
      {initials(name)}
    </span>
  );
}
