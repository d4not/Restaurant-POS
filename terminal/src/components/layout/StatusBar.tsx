import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../store/session';

// Format HH:MM in the user's locale, 24-hour. Updated every 30s — second-level
// precision isn't needed and avoids burning CPU on the kiosk.
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function StatusBar() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const clock = useClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The Lock action drops the session and bounces to the PIN screen. Per spec
  // this is treated the same as logout for now — when we add the "lock screen
  // without ending the shift" flow it can be split into two paths.
  function lock() {
    logout();
    navigate('/login', { replace: true });
  }

  // Close the menu when clicking outside. A simple outside-click listener is
  // enough for a single dropdown — a full Popover primitive would be
  // overkill.
  useEffect(() => {
    if (!menuOpen) return;
    function handler(ev: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!user) return null;

  const canManageRegister =
    user.role === 'CASHIER' || user.role === 'ADMIN' || user.role === 'MANAGER';

  return (
    <header className="statusbar">
      <div className="brand">Restaurant POS</div>
      <div className="spacer" />
      <div className="clock">{clock}</div>
      <div className="user">
        <div className="avatar">{initials(user.name)}</div>
        <div className="meta">
          <div className="name">{user.name}</div>
          <div className="role">{user.role}</div>
        </div>
      </div>

      <div className="sb-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="sb-menu-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Open menu"
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="sb-menu" role="menu">
            <button
              type="button"
              className="sb-menu-item"
              onClick={() => {
                setMenuOpen(false);
                navigate('/floor');
              }}
            >
              ⌂ Floor Plan
            </button>
            <button
              type="button"
              className="sb-menu-item"
              onClick={() => {
                setMenuOpen(false);
                navigate('/orders');
              }}
            >
              📋 Active Orders
            </button>
            {canManageRegister && (
              <button
                type="button"
                className="sb-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/register');
                }}
              >
                💰 Cash Register
              </button>
            )}
            <button
              type="button"
              className="sb-menu-item"
              onClick={() => {
                setMenuOpen(false);
                navigate('/settings/printer');
              }}
            >
              🖨 Printer Settings
            </button>
          </div>
        )}
      </div>

      <button type="button" className="btn btn-ghost" onClick={lock}>
        Lock
      </button>
    </header>
  );
}
