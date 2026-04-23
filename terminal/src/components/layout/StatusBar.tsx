import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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

function tabClass({ isActive }: { isActive: boolean }): string {
  return 'statusbar-tab' + (isActive ? ' active' : '');
}

export function StatusBar() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const clock = useClock();

  // The Lock action drops the session and bounces to the PIN screen. Per spec
  // this is treated the same as logout for now — when we add the "lock screen
  // without ending the shift" flow it can be split into two paths.
  function lock() {
    logout();
    navigate('/login', { replace: true });
  }

  if (!user) return null;

  const canManageRegister =
    user.role === 'CASHIER' || user.role === 'ADMIN' || user.role === 'MANAGER';

  return (
    <header className="statusbar">
      <div className="brand">Restaurant POS</div>

      <nav className="statusbar-tabs" aria-label="Primary">
        <NavLink to="/floor" className={tabClass}>
          <span className="tab-icon" aria-hidden="true">⌂</span>
          <span>Floor Plan</span>
        </NavLink>
        <NavLink to="/orders" className={tabClass}>
          <span className="tab-icon" aria-hidden="true">📋</span>
          <span>Active Orders</span>
        </NavLink>
        {canManageRegister && (
          <NavLink to="/register" className={tabClass}>
            <span className="tab-icon" aria-hidden="true">💰</span>
            <span>Cash Register</span>
          </NavLink>
        )}
        <NavLink to="/settings/printer" className={tabClass}>
          <span className="tab-icon" aria-hidden="true">🖨</span>
          <span>Printer Settings</span>
        </NavLink>
      </nav>

      <div className="statusbar-right">
        <div className="clock">{clock}</div>
        <div className="user">
          <div className="avatar">{initials(user.name)}</div>
          <div className="meta">
            <div className="name">{user.name}</div>
            <div className="role">{user.role}</div>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={lock}>
          Lock
        </button>
      </div>
    </header>
  );
}
