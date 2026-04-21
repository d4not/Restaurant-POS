import { NavLink, useLocation } from 'react-router-dom';
import { NAV } from '../../routes/config';
import { useAuthStore } from '../../store/auth';
import { useUiStore } from '../../store/ui';
import { initials } from '../../utils/format';

export function Sidebar() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openGroups = useUiStore((s) => s.openGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);

  const userName = user?.name ?? 'Administrador';
  const userRole = user?.role ?? 'ADMIN';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="name">Restaurant POS</div>
        <div className="sub">PANEL DE ADMINISTRACIÓN</div>
      </div>

      <nav className="nav">
        {NAV.map((entry) => {
          if (entry.kind === 'single') {
            return (
              <NavLink
                key={entry.id}
                to={entry.path}
                end
                className={({ isActive }) => `nav-single${isActive ? ' active' : ''}`}
              >
                <span>{entry.icon}</span>
                {entry.label}
              </NavLink>
            );
          }

          const isOpen = openGroups.includes(entry.id);
          // Force-open any group whose child matches the current route so the
          // active item is visible even if the user collapsed it earlier.
          const hasActiveChild = entry.items.some((i) => pathname.startsWith(i.path));
          const expanded = isOpen || hasActiveChild;

          return (
            <div key={entry.id}>
              <button
                type="button"
                className={`nav-group-header${expanded ? ' open' : ''}`}
                onClick={() => toggleGroup(entry.id)}
              >
                <span className="label">
                  {entry.icon} {entry.label}
                </span>
                <span className="arrow">▶</span>
              </button>

              {expanded &&
                entry.items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    className={({ isActive }) =>
                      `nav-item${isActive ? ' active' : ''}`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}

              <hr className="nav-divider" />
            </div>
          );
        })}
      </nav>

      <div className="sidebar-user">
        <div className="avatar">{initials(userName)}</div>
        <div className="user-info">
          <div className="user-name">{userName}</div>
          <div className="user-role">{roleLabel(userRole)} · Turno AM</div>
        </div>
        <button
          type="button"
          className="logout-btn"
          onClick={logout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          ⇥
        </button>
      </div>
    </aside>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'ADMIN':   return 'Administrador';
    case 'MANAGER': return 'Gerente';
    case 'CASHIER': return 'Cajero';
    case 'BARISTA': return 'Barista';
    default:        return role;
  }
}
