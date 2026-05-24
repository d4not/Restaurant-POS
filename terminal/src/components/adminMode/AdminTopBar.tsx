// Slim top bar that replaces the regular TopBar while admin mode is active.
// Mirrors the warm dark band of the regular topbar so chrome stays coherent,
// but the center column is a breadcrumb (Admin / Section / View) — restrained
// product chrome, not a decorative title block.

import { adminStyles } from './styles';
import { IconChevronLeft } from '../Icons';
import { IconSearch } from './icons';
import { getInitials } from '../../utils/clock';
import { useSession } from '../../store/session';
import { useTranslation } from '../../i18n';

interface AdminTopBarProps {
  onExit: () => void;
  onOpenPalette: () => void;
  /** Breadcrumb trail after the leading "Admin" root. Empty array = root.
   *  Each entry is already a translated label (Section name, View name…). */
  crumbs?: string[];
}

export function AdminTopBar({ onExit, onOpenPalette, crumbs = [] }: AdminTopBarProps) {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || '');

  const rootLabel = t('admin.title');
  const hasCrumbs = crumbs.length > 0;

  return (
    <header style={adminStyles.topbar}>
      <div style={adminStyles.topbarLeft}>
        <button
          type="button"
          style={adminStyles.backBtn}
          onClick={onExit}
          aria-label={t('admin.exit')}
        >
          <IconChevronLeft style={{ fontSize: 18 }} />
          <span>{t('admin.exit')}</span>
        </button>
      </div>

      <nav style={adminStyles.topbarCenter} aria-label={rootLabel}>
        <span
          style={{
            ...adminStyles.crumb,
            ...(hasCrumbs ? adminStyles.crumbMuted : adminStyles.crumbActive),
          }}
        >
          {rootLabel}
        </span>
        {crumbs.map((label, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={`${i}-${label}`} style={adminStyles.crumbGroup}>
              <span aria-hidden="true" style={adminStyles.crumbSep}>
                /
              </span>
              <span
                style={{
                  ...adminStyles.crumb,
                  ...(isLast ? adminStyles.crumbActive : adminStyles.crumbMuted),
                }}
                aria-current={isLast ? 'page' : undefined}
              >
                {label}
              </span>
            </span>
          );
        })}
      </nav>

      <div style={adminStyles.topbarRight}>
        <button
          type="button"
          style={adminStyles.searchPill}
          onClick={onOpenPalette}
          aria-label={t('common.search')}
        >
          <IconSearch style={{ fontSize: 13 }} />
          <span style={{ opacity: 0.7 }}>{t('common.search')}</span>
          <span
            style={{
              fontFamily:
                'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'rgba(232,221,208,0.10)',
              color: 'rgba(232,221,208,0.85)',
              marginLeft: 2,
            }}
          >
            {isMac ? '⌘K' : 'Ctrl+K'}
          </span>
        </button>

        <div style={adminStyles.userPill}>
          <div style={adminStyles.userInitials}>
            {user ? getInitials(user.name) : '·'}
          </div>
          <div style={adminStyles.userText}>
            <span style={adminStyles.userName}>{user?.name ?? '—'}</span>
            <span style={adminStyles.userRole}>{user?.role ?? ''}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
