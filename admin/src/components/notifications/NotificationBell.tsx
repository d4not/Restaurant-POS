/**
 * Bell icon + unread badge for the admin web Topbar. Mirrors the terminal's
 * NotificationBell, but uses the warm-light-theme `notif-btn` class from
 * `docs/mockup-style.css` instead of the dark-on-dark TopBar pattern.
 *
 * Exported standalone — Track B mounts it in `components/layout/Topbar.tsx`.
 */

import { useEffect, useRef, useState } from 'react';
import { useUnreadNotificationCount } from '../../hooks/useNotifications';
import { NotificationDropdown } from './NotificationDropdown';

export interface NotificationBellProps {
  className?: string;
  style?: React.CSSProperties;
}

const wrap: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
};

const badge: React.CSSProperties = {
  position: 'absolute',
  top: -4,
  right: -4,
  minWidth: 18,
  height: 18,
  padding: '0 5px',
  borderRadius: 9,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid var(--surface)',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};

export function NotificationBell({ className, style }: NotificationBellProps) {
  const unread = useUnreadNotificationCount();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const visibleCount = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={containerRef} className={className} style={{ ...wrap, ...style }}>
      <button
        type="button"
        className="notif-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        style={{ position: 'relative' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm6.5-6V11a6.5 6.5 0 0 0-5.25-6.38V4a1.25 1.25 0 1 0-2.5 0v.62A6.5 6.5 0 0 0 5.5 11v5l-1.75 1.75A.5.5 0 0 0 4.1 18.5h15.8a.5.5 0 0 0 .35-.85L18.5 16Z"
            fill="currentColor"
          />
        </svg>
      </button>
      {unread > 0 && <span style={badge}>{visibleCount}</span>}
      {open && <NotificationDropdown onClose={() => setOpen(false)} />}
    </div>
  );
}
