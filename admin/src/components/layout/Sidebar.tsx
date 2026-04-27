import { NavLink, useLocation } from 'react-router-dom';
import { NAV } from '../../routes/config';
import { useAuthStore } from '../../store/auth';
import { useUiStore } from '../../store/ui';
import { useCurrentUserRegister } from '../../hooks/useRegisters';
import { initials } from '../../utils/format';
import { useTranslation } from '../../i18n';

export function Sidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openGroups = useUiStore((s) => s.openGroups);
  const toggleGroup = useUiStore((s) => s.toggleGroup);
  const currentShiftQ = useCurrentUserRegister(user?.id);

  const userName = user?.name ?? t('auth.administrator');
  const userRole = user?.role ?? 'ADMIN';
  const shiftLabel = currentShiftQ.data ? t('auth.shiftActive') : t('auth.noShift');

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="name">{t('nav.brand')}</div>
        <div className="sub">{t('auth.adminPanel').toUpperCase()}</div>
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
                {t(entry.labelKey)}
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
                  {entry.icon} {t(entry.labelKey)}
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
                    {t(item.labelKey)}
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
          <div className="user-role">{roleLabel(userRole, t)} · {shiftLabel}</div>
        </div>
        <button
          type="button"
          className="logout-btn"
          onClick={logout}
          title={t('common.signOut')}
          aria-label={t('common.signOut')}
        >
          ⇥
        </button>
      </div>
    </aside>
  );
}

function roleLabel(role: string, t: (key: string) => string): string {
  switch (role) {
    case 'ADMIN':   return t('role.admin');
    case 'MANAGER': return t('role.manager');
    case 'CASHIER': return t('role.cashier');
    case 'BARISTA': return t('role.barista');
    case 'WAITER':  return t('role.waiter');
    default:        return role;
  }
}
