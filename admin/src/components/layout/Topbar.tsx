import { useLocation } from 'react-router-dom';
import { findBreadcrumb } from '../../routes/config';
import { formatTopbarDate } from '../../utils/format';

export function Topbar() {
  const { pathname } = useLocation();
  const { label, group } = findBreadcrumb(pathname);

  return (
    <div className="topbar">
      <div className="page-title">
        {group && <div className="breadcrumb">{group} /</div>}
        <h1>{label}</h1>
      </div>
      <div className="topbar-actions">
        <div className="date-badge">{formatTopbarDate()}</div>
        <button type="button" className="notif-btn" title="Notifications" aria-label="Notifications">
          🔔
        </button>
      </div>
    </div>
  );
}
