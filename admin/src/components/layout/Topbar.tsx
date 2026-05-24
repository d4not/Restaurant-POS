import { useLocation } from 'react-router-dom';
import { findBreadcrumb } from '../../routes/config';
import { formatTopbarDate } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { StockBellButton } from './StockBellButton';
import { NotificationBell } from '../notifications';

export function Topbar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { labelKey, groupKey } = findBreadcrumb(pathname);

  return (
    <div className="topbar">
      <div className="page-title">
        {groupKey && <div className="breadcrumb">{t(groupKey)} /</div>}
        <h1>{t(labelKey)}</h1>
      </div>
      <div className="topbar-actions">
        <StockBellButton />
        <NotificationBell />
        <div className="date-badge">{formatTopbarDate()}</div>
      </div>
    </div>
  );
}
