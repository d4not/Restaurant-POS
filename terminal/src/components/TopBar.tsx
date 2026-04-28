import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../store/session';
import { useUi, type TerminalView } from '../store/ui';
import { formatTime, formatDate, getInitials, useClock } from '../utils/clock';
import {
  IconClock,
  IconGrid,
  IconList,
  IconLock,
  IconMenu,
  IconPlus,
  IconSettings,
  IconSignOut,
} from './Icons';
import { OperationsPill } from './RegisterPanel';
import { OperationsHubModal } from './operations-hub/OperationsHubModal';
import { PinConfirmModal } from './PinConfirmModal';
import { verifyPin } from '../api/auth';
import { ApiError } from '../api/client';
import { createOrder, fetchOrder, type TakeoutChannel } from '../api/orders';
import { fetchCurrentRegister } from '../api/registers';
import { fetchSettings } from '../api/settings';
import { useTakeoutChannelLabel } from './TakeoutChannelPicker';
import { TakeoutChannelPicker } from './TakeoutChannelPicker';
import { IconChevronLeft } from './Icons';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n/en';

interface NavTab {
  view: TerminalView;
  labelKey: TranslationKey;
  icon: typeof IconGrid;
}

const TABS: NavTab[] = [
  { view: 'orders', labelKey: 'nav.activeOrders', icon: IconList },
  { view: 'floor', labelKey: 'nav.floorPlan', icon: IconGrid },
  { view: 'history', labelKey: 'nav.orderHistory', icon: IconClock },
];

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    height: 56,
    background: 'var(--sidebar)',
    color: '#e8ddd0',
    padding: '0 16px',
    flexShrink: 0,
    borderBottom: '1px solid rgba(0,0,0,0.2)',
    gap: 16,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: '100%',
    minWidth: 0,
  },
  brandWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingRight: 18,
    borderRight: '1px solid rgba(232,221,208,0.1)',
    height: '100%',
  },
  brand: {
    width: 32,
    height: 32,
    borderRadius: 7,
    background: 'linear-gradient(135deg, #c9a45c 0%, #a8843f 100%)',
    color: '#2c2420',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 700,
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.1,
  },
  brandName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
  brandSub: {
    fontSize: 9,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.45)',
    marginTop: 1,
  },
  newOrderBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 12px',
    borderRadius: 8,
    background: 'rgba(232,221,208,0.08)',
    color: '#e8ddd0',
    fontSize: 12,
    fontWeight: 600,
    minHeight: 38,
    border: '1px solid rgba(232,221,208,0.12)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  newOrderBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  newOrderError: {
    fontSize: 11,
    color: '#e8a597',
    paddingLeft: 4,
    maxWidth: 220,
  },
  navList: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    height: '100%',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    height: '100%',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  clockGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    lineHeight: 1.15,
    color: 'rgba(232,221,208,0.72)',
  },
  clockTime: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    fontVariantNumeric: 'tabular-nums',
  },
  clockDate: {
    fontSize: 9,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.5)',
    marginTop: 1,
  },
  user: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    borderLeft: '1px solid rgba(232,221,208,0.1)',
    height: '100%',
    flexShrink: 0,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6b5e54, #2c2420)',
    color: '#e8ddd0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: 12,
    border: '1px solid rgba(232,221,208,0.12)',
  },
  userText: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 },
  userName: { fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' },
  userMeta: {
    fontSize: 9,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.5)',
    marginTop: 1,
    whiteSpace: 'nowrap',
  },
  hamburger: {
    width: 38,
    height: 38,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(232,221,208,0.06)',
    color: '#e8ddd0',
    cursor: 'pointer',
    fontSize: 17,
  },
  // Contextual detail header — replaces the brand+takeout cluster on the left
  // when view==='detail'. Mirrors the Loyverse pattern: ‹ Back chip + tab pills.
  detailBackBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 12px 7px 8px',
    borderRadius: 8,
    background: 'rgba(232,221,208,0.06)',
    color: '#e8ddd0',
    border: '1px solid rgba(232,221,208,0.12)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    minHeight: 38,
    fontFamily: 'inherit',
  },
  detailTitleBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    lineHeight: 1.15,
    minWidth: 0,
  },
  detailTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 360,
  },
  detailSub: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.55)',
    marginTop: 3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 360,
  },
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.32)',
    zIndex: 40,
  },
  drawer: {
    position: 'fixed',
    top: 76,
    right: 12,
    width: 280,
    background: '#1f1814',
    color: '#e8ddd0',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    border: '1px solid rgba(232,221,208,0.08)',
  },
  drawerSection: {
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.4)',
    padding: '14px 18px 6px',
  },
  drawerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 18px',
    fontSize: 14,
    color: '#e8ddd0',
    cursor: 'pointer',
    minHeight: 48,
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
    background: 'transparent',
    border: 'none',
    transition: 'background 0.12s',
  },
  drawerDivider: {
    height: 1,
    background: 'rgba(232,221,208,0.08)',
    margin: '6px 0',
  },
};

const navBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  borderRadius: 8,
  color: active ? '#2c2420' : 'rgba(232,221,208,0.78)',
  background: active ? 'var(--gold)' : 'transparent',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  transition: 'all 0.15s',
  cursor: 'pointer',
  minHeight: 38,
  fontFamily: 'inherit',
});

// Roles allowed into the Order History screen — waiters never see the tab.
const HISTORY_ROLES: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

export function TopBar() {
  const { t } = useTranslation();
  const channelLabel = useTakeoutChannelLabel();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const menuOpen = useUi((s) => s.menuOpen);
  const toggleMenu = useUi((s) => s.toggleMenu);
  const closeMenu = useUi((s) => s.closeMenu);
  const openSettings = useUi((s) => s.openSettings);
  const openOrderDetail = useUi((s) => s.openOrderDetail);
  const closeOrderDetail = useUi((s) => s.closeOrderDetail);
  const detailOrderId = useUi((s) => s.detailOrderId);
  const historyUnlocked = useUi((s) => s.historyUnlocked);
  const unlockHistory = useUi((s) => s.unlockHistory);
  const resetSession = useUi((s) => s.resetSession);
  const isDetail = view === 'detail';

  const user = useSession((s) => s.user);
  const lock = useSession((s) => s.lock);
  const signOut = useSession((s) => s.signOut);

  const role = user?.role ?? 'WAITER';
  const canSeeHistory = HISTORY_ROLES.has(role);

  const now = useClock(15_000);
  const queryClient = useQueryClient();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [historyPinOpen, setHistoryPinOpen] = useState(false);
  const [historyPinBusy, setHistoryPinBusy] = useState(false);
  const [historyPinError, setHistoryPinError] = useState<string | null>(null);
  const [takeoutError, setTakeoutError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Singleton-shift lookup: any open register works for takeout creation,
  // regardless of who opened it. App.tsx primes the cache with the same key
  // so this typically hits without a network round-trip.
  const userId = user?.id ?? null;
  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: !!userId,
    staleTime: 15_000,
  });

  // Fetch the per-channel active flags so the picker can grey out anything
  // currently disabled. Cheap (returns the whole settings dict) so we share
  // the cache key with the rest of the app.
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  });

  // When view==='detail' we mirror TableDetail's order query (same key) so
  // the topbar can show "Order #X / Table Y · Zone" without a second round
  // trip — TanStack dedupes against the cache TableDetail already populated.
  const detailOrderQuery = useQuery({
    queryKey: ['order', detailOrderId],
    queryFn: () => fetchOrder(detailOrderId!),
    enabled: isDetail && !!detailOrderId,
    staleTime: 8_000,
  });
  const detailOrder = detailOrderQuery.data ?? null;
  const detailTitle = detailOrder
    ? `${t('detail.orderNumber')}${detailOrder.order_number}`
    : t('detail.orderNumber').replace('#', '').trim() || 'Order';
  const detailSub = detailOrder
    ? detailOrder.order_type === 'TAKEOUT'
      ? detailOrder.takeout_channel
        ? channelLabel(detailOrder.takeout_channel)
        : t('detail.takeoutLabel')
      : detailOrder.table
        ? `${t('detail.tableLabel')} ${detailOrder.table.number} · ${detailOrder.table.zone.name}`
        : t('history.statusOpen')
    : '';

  const takeoutMutation = useMutation({
    mutationFn: (channel: TakeoutChannel) => {
      const reg = registerQuery.data;
      if (!reg) {
        return Promise.reject(
          new ApiError(t('takeout.noShift'), 409),
        );
      }
      return createOrder({
        register_id: reg.id,
        order_type: 'TAKEOUT',
        takeout_channel: channel,
      });
    },
    onSuccess: (order) => {
      setTakeoutError(null);
      setPickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      openOrderDetail(order.id);
    },
    onError: (err) => {
      setTakeoutError(err instanceof ApiError ? err.message : t('error.somethingWrong'));
    },
  });

  const visibleTabs = TABS.filter((tab) => tab.view !== 'history' || canSeeHistory);

  function handleTabClick(tab: NavTab) {
    if (tab.view === 'history' && !historyUnlocked) {
      setHistoryPinError(null);
      setHistoryPinOpen(true);
      return;
    }
    setView(tab.view);
  }

  async function confirmHistoryPin(pin: string) {
    setHistoryPinBusy(true);
    setHistoryPinError(null);
    try {
      await verifyPin(pin, 'self');
      unlockHistory();
      setHistoryPinOpen(false);
      setView('history');
    } catch (e) {
      setHistoryPinError(
        e instanceof ApiError ? e.message : t('pin.invalid'),
      );
    } finally {
      setHistoryPinBusy(false);
    }
  }

  function handleSignOut() {
    resetSession();
    signOut();
  }
  function handleLock() {
    resetSession();
    lock();
  }

  // Close the drawer on Escape — touch terminals don't always have Escape on
  // the on-screen keyboard, but a physical keyboard remains the dev affordance.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, closeMenu]);

  return (
    <header className="topbar-root" style={styles.root}>
      {isDetail ? (
        <div style={styles.left}>
          <button
            type="button"
            style={styles.detailBackBtn}
            onClick={closeOrderDetail}
            aria-label={t('common.back')}
          >
            <IconChevronLeft style={{ fontSize: 18 }} />
            <span>{t('common.back')}</span>
          </button>
        </div>
      ) : (
        <div style={styles.left}>
          <div className="topbar-brand-wrap" style={styles.brandWrap}>
            <div style={styles.brand}>R</div>
            <div style={styles.brandText}>
              <span style={styles.brandName}>Restaurant POS</span>
              <span className="topbar-brand-sub" style={styles.brandSub}>Terminal</span>
            </div>
          </div>
          <button
            type="button"
            style={{
              ...styles.newOrderBtn,
              ...(takeoutMutation.isPending ? styles.newOrderBtnDisabled : null),
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTakeoutError(null);
              setPickerOpen(true);
            }}
            disabled={takeoutMutation.isPending}
            title={t('takeout.newTakeout')}
          >
            <IconPlus />
            <span className="topbar-takeout-label">{takeoutMutation.isPending ? `${t('common.loading')}…` : t('takeout.newTakeout')}</span>
          </button>
          {takeoutError && !pickerOpen && (
            <span style={styles.newOrderError}>{takeoutError}</span>
          )}
        </div>
      )}

      {isDetail ? (
        <div style={styles.detailTitleBlock}>
          <span style={styles.detailTitle}>{detailTitle}</span>
          {detailSub && <span style={styles.detailSub}>{detailSub}</span>}
        </div>
      ) : (
        <nav style={styles.navList}>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                style={navBtnStyle(active)}
                onClick={() => handleTabClick(tab)}
              >
                <Icon style={{ fontSize: 18 }} />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="topbar-right" style={styles.right}>
        <OperationsPill onClick={() => setHubOpen(true)} />
        <div style={styles.clockGroup}>
          <span style={styles.clockTime}>{formatTime(now)}</span>
          <span className="topbar-clock-date" style={styles.clockDate}>{formatDate(now)}</span>
        </div>

        <div className="topbar-user" style={styles.user}>
          <div style={styles.avatar}>
            {user ? getInitials(user.name) : '·'}
          </div>
          <div className="topbar-user-text" style={styles.userText}>
            <span style={styles.userName}>{user?.name ?? t('nav.signOut')}</span>
            <span style={styles.userMeta}>{user?.role ?? '—'}</span>
          </div>
        </div>

        <button
          type="button"
          style={styles.hamburger}
          onClick={toggleMenu}
          aria-label={t('nav.menu')}
        >
          <IconMenu />
        </button>
      </div>

      <TakeoutChannelPicker
        open={pickerOpen}
        busy={takeoutMutation.isPending}
        error={takeoutError}
        settings={settingsQuery.data}
        onCancel={() => {
          setPickerOpen(false);
          setTakeoutError(null);
        }}
        onChoose={(channel) => takeoutMutation.mutate(channel)}
      />

      <OperationsHubModal open={hubOpen} onClose={() => setHubOpen(false)} />

      {historyPinOpen && (
        <PinConfirmModal
          title={t('nav.orderHistory')}
          message={t('pin.selfSub')}
          confirmLabel={t('common.confirm')}
          busy={historyPinBusy}
          error={historyPinError}
          onClose={() => setHistoryPinOpen(false)}
          onConfirm={confirmHistoryPin}
        />
      )}

      {menuOpen && (
        <>
          <div style={styles.scrim} onClick={closeMenu} />
          <div ref={drawerRef} style={styles.drawer} role="menu">
            <div style={styles.drawerSection}>{t('login.signedInAs')}</div>
            <button type="button" style={styles.drawerItem} onClick={openSettings}>
              <IconSettings />
              <span>{t('nav.settings')}</span>
            </button>
            <button
              type="button"
              style={styles.drawerItem}
              onClick={() => {
                closeMenu();
                handleLock();
              }}
            >
              <IconLock />
              <span>{t('nav.lockScreen')}</span>
            </button>
            <div style={styles.drawerDivider} />
            <button
              type="button"
              style={styles.drawerItem}
              onClick={() => {
                closeMenu();
                handleSignOut();
              }}
            >
              <IconSignOut />
              <span>{t('nav.signOut')}</span>
            </button>
          </div>
        </>
      )}
    </header>
  );
}
