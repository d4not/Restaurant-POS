import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getActiveOrders } from '../api/floors';
import { cancelOrder } from '../api/orders';
import { ApiError } from '../api/client';
import { ROLE_CAN_CANCEL, useSessionStore } from '../store/session';
import { useToastStore } from '../store/toast';
import { formatMoney, relativeTime } from '../utils/format';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import type { ActiveOrder } from '../types/api';

type FilterKey = 'all' | 'pending' | 'sent' | 'flagged';

// Active orders list for cashiers / baristas. Polls every 10s so new orders
// from the waiter terminals appear without manual refresh. Tapping a card
// navigates to the full OrderPage.
export function OrdersListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const pushToast = useToastStore((s) => s.push);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [cancelTarget, setCancelTarget] = useState<ActiveOrder | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: getActiveOrders,
    refetchInterval: 10_000,
  });

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => cancelOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      pushToast('Order cancelled', 'info');
      setCancelTarget(null);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not cancel order';
      pushToast(msg, 'error');
    },
  });

  const canCancel = user ? ROLE_CAN_CANCEL.includes(user.role) : false;

  // Filter orders on the client since the full active-orders list is small
  // (< 30 items) and we already have everything in memory.
  const flaggedCount = useMemo(
    () => (data ?? []).filter((o) => o.needs_attention).length,
    [data],
  );
  const filteredOrders = useMemo(() => {
    if (!data) return [];
    switch (filter) {
      case 'pending':
        return data.filter((o) =>
          o.items.some((it) => !it.sent_to_kitchen),
        );
      case 'sent':
        return data.filter(
          (o) => o.items.length > 0 && o.items.every((it) => it.sent_to_kitchen),
        );
      case 'flagged':
        return data.filter((o) => o.needs_attention);
      case 'all':
      default:
        return data;
    }
  }, [data, filter]);

  return (
    <div className="page">
      <header className="page-header">
        <div className="title">
          <div className="crumb">Service</div>
          <h1>Active Orders</h1>
        </div>
        {flaggedCount > 0 && (
          <div className="attention-summary">
            <span className="dot" />
            {flaggedCount} order{flaggedCount === 1 ? '' : 's'} need{flaggedCount === 1 ? 's' : ''} the cashier
          </div>
        )}
      </header>

      <div className="filter-row">
        <FilterPill
          label="All"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={(data ?? []).length}
        />
        <FilterPill
          label="Pending"
          active={filter === 'pending'}
          onClick={() => setFilter('pending')}
          count={(data ?? []).filter((o) => o.items.some((it) => !it.sent_to_kitchen)).length}
        />
        <FilterPill
          label="Sent"
          active={filter === 'sent'}
          onClick={() => setFilter('sent')}
          count={
            (data ?? []).filter(
              (o) => o.items.length > 0 && o.items.every((it) => it.sent_to_kitchen),
            ).length
          }
        />
        <FilterPill
          label="Flagged"
          active={filter === 'flagged'}
          onClick={() => setFilter('flagged')}
          count={flaggedCount}
          tone={flaggedCount > 0 ? 'warn' : 'default'}
        />
      </div>

      {isLoading && (
        <div className="empty">
          <div className="title">Loading orders…</div>
        </div>
      )}

      {error && (
        <div className="empty">
          <div className="icon">!</div>
          <div className="title">Could not load orders</div>
          <div>{(error as Error).message}</div>
        </div>
      )}

      {data && filteredOrders.length === 0 && !isLoading && (
        <div className="empty">
          <div className="icon">☕</div>
          <div className="title">
            {filter === 'all' ? 'No active orders' : 'Nothing in this bucket'}
          </div>
          <div>
            {filter === 'all'
              ? 'New orders opened by waiters will appear here.'
              : 'Switch filters above to see other orders.'}
          </div>
        </div>
      )}

      {data && filteredOrders.length > 0 && (
        <div className="orders-grid">
          {filteredOrders.map((order) => {
            const sentCount = order.items.filter((it) => it.sent_to_kitchen).length;
            const pending = order.items.length - sentCount;
            return (
              <div
                key={order.id}
                className={`order-card ${order.needs_attention ? 'flagged' : ''}`}
              >
                <button
                  type="button"
                  className="order-card-main"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <h3>#{order.order_number}</h3>
                    <span
                      className={`order-type ${order.order_type === 'TAKEOUT' ? 'takeout' : ''}`}
                    >
                      {order.order_type === 'DINE_IN' ? 'Dine In' : 'Takeout'}
                    </span>
                  </div>

                  {order.needs_attention && (
                    <div className="order-flag">
                      <span className="flag-tag">⚑ Needs cashier</span>
                      {order.attention_reason && (
                        <span className="flag-reason">
                          “{order.attention_reason}”
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-mute" style={{ fontSize: 13 }}>
                    {order.table
                      ? `${order.table.zone.name} · Table ${order.table.number}`
                      : 'Takeout'}
                  </div>
                  <div className="text-mute" style={{ fontSize: 13 }}>
                    {order.user.name} · {relativeTime(order.created_at)}
                  </div>

                  <div className="order-card-footer">
                    <span className="text-mute" style={{ fontSize: 12 }}>
                      {order.items.length} item{order.items.length === 1 ? '' : 's'}
                      {pending > 0 ? ` · ${pending} pending` : ''}
                    </span>
                    <span style={{ fontSize: 22, fontWeight: 700 }}>
                      {formatMoney(order.total)}
                    </span>
                  </div>
                </button>
                {canCancel && (
                  <div className="order-card-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setCancelTarget(order)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel order #${cancelTarget?.order_number ?? ''}?`}
        message={
          `This cannot be undone. Items already sent to the kitchen will not be ` +
          `reversed automatically — make sure to tell the kitchen.`
        }
        confirmLabel="Yes, cancel"
        cancelLabel="Keep order"
        tone="danger"
        busy={cancelMutation.isPending}
        onConfirm={() => {
          if (cancelTarget) cancelMutation.mutate(cancelTarget.id);
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}

function FilterPill({
  label,
  active,
  count,
  tone = 'default',
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  tone?: 'default' | 'warn';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`cat-pill ${active ? 'active' : ''} ${tone === 'warn' ? 'warn' : ''}`}
      onClick={onClick}
    >
      {label}
      <span className="pill-count">{count}</span>
    </button>
  );
}
