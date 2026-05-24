/**
 * Admin web notifications dropdown. Warm-light surface (matches the rest of
 * the admin panel), with the same row layout as the terminal variant.
 */

import {
  useNotifications,
  useMarkNotificationRead,
} from '../../hooks/useNotifications';
import type { NotificationRow } from '../../api/notifications';

export interface NotificationDropdownProps {
  onClose?: () => void;
}

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 10px)',
  right: 0,
  width: 380,
  maxHeight: 500,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-lg)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 300,
};

const header: React.CSSProperties = {
  padding: '14px 16px 10px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const headerTitle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text)',
};

const headerSub: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const list: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const item: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
};

const itemUnread: React.CSSProperties = {
  ...item,
  background: '#fef8ef',
};

const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  marginTop: 8,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
  margin: 0,
  lineHeight: 1.3,
};

const bodyStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  margin: '4px 0 0',
  lineHeight: 1.4,
};

const tsStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  marginTop: 6,
  letterSpacing: '0.04em',
};

const emptyStyle: React.CSSProperties = {
  padding: '36px 18px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const errStyle: React.CSSProperties = {
  padding: '24px 18px',
  textAlign: 'center',
  color: 'var(--red)',
  fontSize: 13,
};

function severityColor(s: NotificationRow['severity']): string {
  switch (s) {
    case 'CRITICAL':
    case 'ERROR':
      return 'var(--red)';
    case 'WARNING':
      return 'var(--gold)';
    case 'INFO':
    default:
      return 'var(--green)';
  }
}

function formatTs(iso: string): string {
  const then = new Date(iso);
  const now = Date.now();
  const diffMin = Math.floor((now - then.getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return then.toLocaleDateString();
}

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const q = useNotifications({ limit: 20 });
  const markRead = useMarkNotificationRead();

  const items = q.data?.items ?? [];
  const unread = q.data?.unread_count ?? 0;

  return (
    <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
      <div style={header}>
        <h3 style={headerTitle}>Notifications</h3>
        <span style={headerSub}>{unread} unread</span>
      </div>

      <div style={list}>
        {q.isLoading && <div style={emptyStyle}>Loading…</div>}
        {q.isError && <div style={errStyle}>Could not load notifications.</div>}
        {!q.isLoading && !q.isError && items.length === 0 && (
          <div style={emptyStyle}>You're all caught up.</div>
        )}
        {items.map((n) => {
          const isUnread = n.read_at === null;
          return (
            <div
              key={n.id}
              style={isUnread ? itemUnread : item}
              onClick={() => {
                if (isUnread) markRead.mutate(n.id);
                else onClose?.();
              }}
            >
              <div style={{ ...dot, background: severityColor(n.severity) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={titleStyle}>{n.title}</p>
                <p style={bodyStyle}>{n.body}</p>
                <div style={tsStyle}>{formatTs(n.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
