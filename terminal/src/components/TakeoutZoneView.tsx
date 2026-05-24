import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrder, type ActiveOrder, type TakeoutChannel } from '../api/orders';
import { ApiError } from '../api/client';
import type { CashRegisterRow } from '../api/registers';
import {
  ALL_TAKEOUT_CHANNELS,
  channelEnabled,
  fetchSettings,
} from '../api/settings';
import { useTranslation } from '../i18n';
import { useTakeoutChannelLabel } from './TakeoutChannelPicker';
import { useUi } from '../store/ui';
import { formatMoney } from '../utils/format';
import { Spinner } from './Spinner';
import { TakeoutChannelPicker } from './TakeoutChannelPicker';
import { IconClock, IconPlus } from './Icons';

interface Props {
  zoneName: string;
  takeoutOrders: ActiveOrder[];
  register: CashRegisterRow | null;
  onRefetchRegister: () => void;
}

type ChannelFilter = 'ALL' | TakeoutChannel;

const CHANNEL_DOT: Record<TakeoutChannel, string> = {
  LOCAL: 'var(--gold)',
  DELIVERY_LOCAL: 'var(--green)',
  DELIVERY_APP: 'var(--blue, #2a6ac8)',
};

const channelChipStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 32,
});

const channelBadgeStyle = (_channel: TakeoutChannel): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text2)',
});

const timePillStyle = (variant: 'green' | 'gold' | 'red'): React.CSSProperties => {
  const map = {
    green: { bg: 'rgba(74,140,92,0.12)', col: 'var(--green)' },
    gold:  { bg: 'rgba(201,164,92,0.16)', col: '#8a6d2a' },
    red:   { bg: 'rgba(196,80,64,0.12)', col: 'var(--red)' },
  } as const;
  const c = map[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 9px',
    borderRadius: 999,
    background: c.bg,
    color: c.col,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    fontVariantNumeric: 'tabular-nums',
  };
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    padding: '20px 28px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    overflow: 'auto',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  newBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 18px',
    borderRadius: 10,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--text1)',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  newBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text2)',
  },
  errorBox: {
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    borderRadius: 10,
    padding: '12px 14px',
    fontSize: 13,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 14,
  },
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'pointer',
    boxShadow: 'var(--shadow-sm)',
    transition: 'transform 0.12s, box-shadow 0.12s',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardOrder: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1,
  },
  cardSub: {
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    marginTop: 4,
    fontWeight: 600,
  },
  meta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    color: 'var(--text2)',
  },
  total: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 14,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 12,
  },
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function timeVariant(min: number): 'green' | 'gold' | 'red' {
  if (min >= 25) return 'red';
  if (min >= 10) return 'gold';
  return 'green';
}

export function TakeoutZoneView({
  zoneName,
  takeoutOrders,
  register,
  onRefetchRegister,
}: Props) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const channelLabel = useTakeoutChannelLabel();
  const openOrderDetail = useUi((s) => s.openOrderDetail);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<ChannelFilter>('ALL');

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
  });

  const newMutation = useMutation({
    mutationFn: (channel: TakeoutChannel) => {
      if (!register) {
        return Promise.reject(
          new ApiError('No open shift — open one from the top bar.', 409),
        );
      }
      return createOrder({
        register_id: register.id,
        order_type: 'TAKEOUT',
        takeout_channel: channel,
      });
    },
    onSuccess: (order) => {
      setPickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      openOrderDetail(order.id);
    },
  });

  // Channels active for the current settings — used for filter chips so the
  // operator can drill into one channel without seeing the others.
  const visibleChannels = ALL_TAKEOUT_CHANNELS.filter((ch) =>
    channelEnabled(settingsQuery.data, ch),
  );

  const sortedAll = [...takeoutOrders].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const sorted = sortedAll.filter(
    (o) => filter === 'ALL' || o.takeout_channel === filter,
  );

  // Per-channel counts for the chip labels.
  const channelCounts = visibleChannels.reduce<Record<string, number>>(
    (acc, ch) => {
      acc[ch] = sortedAll.filter((o) => o.takeout_channel === ch).length;
      return acc;
    },
    {},
  );

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <button
          type="button"
          style={{
            ...styles.newBtn,
            ...(newMutation.isPending || !register ? styles.newBtnDisabled : null),
          }}
          onClick={() => {
            if (!register) {
              onRefetchRegister();
              return;
            }
            setPickerOpen(true);
          }}
          disabled={newMutation.isPending}
        >
          <IconPlus />
          <span>{newMutation.isPending ? t('takeout.opening') : t('takeout.newTitle')}</span>
        </button>
        <span style={styles.hint}>
          {zoneName} · {(sortedAll.length === 1 ? t('takeout.zoneActiveOne') : t('takeout.zoneActiveMany')).replace('{n}', String(sortedAll.length))}
        </span>
        {newMutation.isPending && <Spinner size={16} />}
      </div>

      {visibleChannels.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={channelChipStyle(filter === 'ALL')}
            onClick={() => setFilter('ALL')}
          >
            {t('common.all')}
            <span style={{ opacity: 0.6, fontSize: 11 }}>{sortedAll.length}</span>
          </button>
          {visibleChannels.map((ch) => (
            <button
              key={ch}
              type="button"
              style={channelChipStyle(filter === ch)}
              onClick={() => setFilter(ch)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: CHANNEL_DOT[ch],
                }}
              />
              {channelLabel(ch)}
              <span style={{ opacity: 0.6, fontSize: 11 }}>
                {channelCounts[ch] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      <TakeoutChannelPicker
        open={pickerOpen}
        busy={newMutation.isPending}
        error={
          newMutation.error instanceof ApiError
            ? newMutation.error.message
            : newMutation.error
              ? t('takeout.couldNotStart')
              : null
        }
        settings={settingsQuery.data}
        onCancel={() => setPickerOpen(false)}
        onChoose={(ch) => newMutation.mutate(ch)}
      />

      {!register && (
        <div style={styles.errorBox}>{t('takeout.noShift')}</div>
      )}

      {newMutation.error && (
        <div style={styles.errorBox}>
          {newMutation.error instanceof ApiError
            ? newMutation.error.message
            : t('takeout.couldNotStart')}
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>📦</div>
          <div>{t('takeout.zoneEmpty')}</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {sorted.map((order) => {
            const min = elapsedMinutes(order.created_at);
            const variant = timeVariant(min);
            const itemCount = order.items.filter((i) => !i.voided_at).length;
            return (
              <div
                key={order.id}
                style={styles.card}
                onClick={() => openOrderDetail(order.id)}
              >
                <div style={styles.cardTopRow}>
                  <div>
                    <div style={styles.cardOrder}>#{order.order_number}</div>
                    <div style={styles.cardSub}>
                      {order.takeout_channel
                        ? channelLabel(order.takeout_channel)
                        : t('takeout.label')}
                    </div>
                  </div>
                  <span style={timePillStyle(variant)}>
                    <IconClock style={{ fontSize: 12 }} />
                    {min} min
                  </span>
                </div>
                {order.takeout_channel && (
                  <span style={channelBadgeStyle(order.takeout_channel)}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: CHANNEL_DOT[order.takeout_channel],
                      }}
                    />
                    {channelLabel(order.takeout_channel)}
                  </span>
                )}
                <div style={styles.meta}>
                  {order.customer_name && (
                    <span style={{ color: 'var(--text1)', fontWeight: 600 }}>
                      {order.customer_name}
                    </span>
                  )}
                  {order.delivery_app && order.delivery_app_order_id && (
                    <span>
                      {order.delivery_app} · #{order.delivery_app_order_id}
                    </span>
                  )}
                  <span>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'} · {order.user.name}
                  </span>
                </div>
                <div style={styles.total}>{formatMoney(order.total)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
