import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFloors } from '../api/floors';
import { createOrder } from '../api/orders';
import { useOpenRegister } from '../hooks/useOpenRegister';
import { useToastStore } from '../store/toast';
import { ApiError } from '../api/client';
import type { FloorTable, FloorZone } from '../types/api';
import { relativeTime } from '../utils/format';

const TAKEOUT_TAB = '__takeout__';
const POLL_INTERVAL_MS = 10_000;

// Builds a CSS class from a TableStatus so the table card gets its status
// tone (green available, gold occupied, blue reserved).
function toneClass(status: FloorTable['status']): string {
  switch (status) {
    case 'AVAILABLE': return 'available';
    case 'OCCUPIED':  return 'occupied';
    case 'RESERVED':  return 'reserved';
  }
}

export function FloorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);

  const [activeZone, setActiveZone] = useState<string | null>(null);

  const floorsQuery = useQuery({
    queryKey: ['floors'],
    queryFn: getFloors,
    // Polling keeps the badge tones fresh while the waiter is staring at the
    // screen; a manual refetch also happens after every createOrder.
    refetchInterval: POLL_INTERVAL_MS,
  });

  const register = useOpenRegister();

  // Default to the first zone once data arrives. Tracked separately from
  // activeZone so the user's explicit pick (or the Takeout tab) sticks across
  // re-renders even if a future refetch reorders zones.
  const zones = floorsQuery.data ?? [];
  const currentZoneId = activeZone ?? zones[0]?.id ?? null;
  const currentZone: FloorZone | null = useMemo(() => {
    if (!currentZoneId || currentZoneId === TAKEOUT_TAB) return null;
    return zones.find((z) => z.id === currentZoneId) ?? null;
  }, [zones, currentZoneId]);

  const createOrderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      // Invalidate both the floor (to flip the table badge) and the active-
      // orders list so the cashier's screen also sees the new order.
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${order.id}`);
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not create order';
      pushToast(message, 'error');
    },
  });

  function openTable(table: FloorTable) {
    if (table.status === 'OCCUPIED' && table.current_order) {
      // Tapping an occupied table resumes its current open order rather than
      // creating a new one. Group-ordering (multiple tickets) is still
      // supported from the order page itself.
      navigate(`/orders/${table.current_order.id}`);
      return;
    }
    if (!register.data) {
      pushToast('Open a cash register to start an order', 'error');
      return;
    }
    createOrderMutation.mutate({
      register_id: register.data.id,
      order_type: 'DINE_IN',
      table_id: table.id,
    });
  }

  function startTakeout() {
    if (!register.data) {
      pushToast('Open a cash register to start an order', 'error');
      return;
    }
    createOrderMutation.mutate({
      register_id: register.data.id,
      order_type: 'TAKEOUT',
    });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="title">
          <div className="crumb">Service</div>
          <h1>Floor Plan</h1>
        </div>
      </header>

      {!register.isLoading && !register.data && (
        <div className="register-banner">
          <div className="msg">No open cash register — open a shift to start taking orders.</div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/register')}
          >
            Open Register
          </button>
        </div>
      )}

      {floorsQuery.isLoading && (
        <div className="empty">
          <div className="title">Loading zones…</div>
        </div>
      )}

      {floorsQuery.error && (
        <div className="empty">
          <div className="icon">!</div>
          <div className="title">Could not load floors</div>
          <div>{(floorsQuery.error as Error).message}</div>
        </div>
      )}

      {floorsQuery.data && floorsQuery.data.length === 0 && (
        <div className="empty">
          <div className="icon">⌂</div>
          <div className="title">No zones configured</div>
          <div>Set up zones and tables in the admin panel to populate the floor.</div>
        </div>
      )}

      {zones.length > 0 && (
        <>
          <nav className="zone-tabs" aria-label="Zone selector">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                className={`zone-tab ${currentZoneId === zone.id ? 'active' : ''}`}
                onClick={() => setActiveZone(zone.id)}
              >
                {zone.name}
              </button>
            ))}
            <button
              type="button"
              className="zone-tab takeout"
              onClick={startTakeout}
              disabled={createOrderMutation.isPending || !register.data}
              title="Create a takeout order (no table)"
            >
              + Takeout
            </button>
          </nav>

          {currentZone && (
            <div className="table-grid">
              {currentZone.tables.length === 0 && (
                <div className="empty" style={{ gridColumn: '1 / -1' }}>
                  <div className="title">No tables in this zone</div>
                </div>
              )}
              {currentZone.tables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className={`table-card ${toneClass(table.status)}`}
                  onClick={() => openTable(table)}
                  disabled={
                    createOrderMutation.isPending ||
                    (table.status === 'AVAILABLE' && !register.data)
                  }
                >
                  <span className="status-bar" />
                  <div>
                    <div className="number">{table.number}</div>
                    <div className="capacity">{table.capacity} seats</div>
                  </div>

                  {table.current_order ? (
                    <div className="order-info">
                      <div className="row">
                        <span>Order #{table.current_order.order_number}</span>
                        <span className="time">
                          {relativeTime(table.current_order.opened_at)}
                        </span>
                      </div>
                      <div className="row">
                        <span>
                          {table.current_order.item_count} item
                          {table.current_order.item_count === 1 ? '' : 's'}
                          {table.open_order_count > 1
                            ? ` · +${table.open_order_count - 1} ticket${table.open_order_count > 2 ? 's' : ''}`
                            : ''}
                        </span>
                        {table.current_order.waiter && (
                          <span className="text-mute">
                            {table.current_order.waiter.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="order-info">
                      <div className="row">
                        <span className="text-mute">Tap to open</span>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
