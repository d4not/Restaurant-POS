/**
 * Bell icon + unread badge. Exported standalone — Track B mounts it inside
 * `TopBar.tsx` next to the user avatar. Until then, the component is a
 * stand-alone control that can be dropped into any layout.
 *
 * Touch-target ≥48px (per MOBILE-SPEC); active state when the dropdown is
 * open uses the same gold-tint pattern as the rest of the dark top bar.
 */

import { useState, useRef, useEffect } from 'react';
import { useUnreadNotificationCount } from '../../hooks/useNotifications';
import { NotificationDropdown } from './NotificationDropdown';

export interface NotificationBellProps {
  /** Color of the bell glyph — defaults to the warm cream used in TopBar. */
  glyphColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

const wrap: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
};

const button: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(232,221,208,0.06)',
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  color: '#e8ddd0',
  transition: 'background 0.15s',
  fontFamily: 'inherit',
};

const buttonActive: React.CSSProperties = {
  ...button,
  background: 'rgba(201,164,92,0.18)',
  color: 'var(--gold)',
};

const badge: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
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
  border: '2px solid var(--sidebar)',
  fontVariantNumeric: 'tabular-nums',
};

export function NotificationBell({ glyphColor, className, style }: NotificationBellProps) {
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
  const fillColor = glyphColor ?? '#e8ddd0';

  return (
    <div ref={containerRef} className={className} style={{ ...wrap, ...style }}>
      <button
        type="button"
        style={open ? buttonActive : button}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm6.5-6V11a6.5 6.5 0 0 0-5.25-6.38V4a1.25 1.25 0 1 0-2.5 0v.62A6.5 6.5 0 0 0 5.5 11v5l-1.75 1.75A.5.5 0 0 0 4.1 18.5h15.8a.5.5 0 0 0 .35-.85L18.5 16Z"
            fill={open ? 'var(--gold)' : fillColor}
          />
        </svg>
        {unread > 0 && <span style={badge}>{visibleCount}</span>}
      </button>
      {open && <NotificationDropdown onClose={() => setOpen(false)} />}
    </div>
  );
}
