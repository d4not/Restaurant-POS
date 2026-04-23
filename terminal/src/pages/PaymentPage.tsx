import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addOrderPayment, getOrder } from '../api/orders';
import { listSettings, TERMINAL_SETTING_KEYS, type SettingsMap } from '../api/settings';
import { ApiError } from '../api/client';
import { ROLE_CAN_PAY, defaultPathForRole, useSessionStore } from '../store/session';
import { useToastStore } from '../store/toast';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { formatMoney } from '../utils/format';
import { Numpad } from '../components/ui/Numpad';
import type {
  ActiveOrder,
  AddPaymentResult,
  Payment,
  PaymentMethod,
} from '../types/api';

// Common cash denominations for quick-tender buttons — these are the bills a
// customer is most likely to hand over in MXN. "Exact" is always first: it
// tenders whatever balance is still owed, which makes the common case a
// single tap.
const QUICK_CASH_AMOUNTS = [50_00, 100_00, 200_00, 500_00] as const;

export function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const pushToast = useToastStore((s) => s.push);

  // Working payment draft. Centavos integer so the numpad can append digits
  // without floating-point drift. Reset to zero after every successful tender
  // so a second split payment starts clean.
  const [amountCentavos, setAmountCentavos] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');

  const orderQuery = useQuery({
    queryKey: ['orders', id],
    queryFn: () => getOrder(id!),
    enabled: Boolean(id),
  });

  // Settings rarely change during a shift. Load once and reuse for the receipt
  // header so we don't burn a round-trip at pay time.
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: listSettings,
    staleTime: 5 * 60_000,
  });

  const order = orderQuery.data;
  const payments = order?.payments ?? [];

  // Remaining balance = order.total - (sum(amount) - sum(change)). Mirrors the
  // backend's `addPayment` calculation so the UI agrees with what the server
  // will accept.
  const { total, paidNet, remaining } = useMemo(() => {
    if (!order) return { total: 0, paidNet: 0, remaining: 0 };
    const totalN = Number(order.total);
    const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const change = payments.reduce((sum, p) => sum + Number(p.change_amount), 0);
    const paidNetN = paid - change;
    return { total: totalN, paidNet: paidNetN, remaining: Math.max(0, totalN - paidNetN) };
  }, [order, payments]);

  const isPaid = order?.status === 'PAID';
  const cashChange =
    method === 'CASH' && amountCentavos > remaining ? amountCentavos - remaining : 0;
  const canSubmit =
    !!order && !isPaid && amountCentavos > 0 && (method === 'CASH' ? amountCentavos > 0 : amountCentavos === remaining);

  const payMutation = useMutation({
    mutationFn: () =>
      addOrderPayment(id!, {
        method,
        amount: amountCentavos,
        reference: method !== 'CASH' && reference.trim() ? reference.trim() : null,
      }),
    onSuccess: async (result: AddPaymentResult) => {
      queryClient.setQueryData(['orders', id], result.order);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      queryClient.invalidateQueries({ queryKey: ['register', 'open'] });

      // Reset the draft so a split second payment starts on zero.
      setAmountCentavos(0);
      setReference('');

      if (result.order.status === 'PAID') {
        // Print after the server confirms the order is settled — the receipt
        // must show the full payment list, including this final tender.
        const printResult = await printReceipt(result.order, settingsQuery.data ?? {});
        if (printResult.ok) {
          pushToast('Payment complete · receipt printed', 'success');
        } else {
          pushToast(
            `Payment complete · receipt not printed: ${printResult.message ?? 'unknown error'}`,
            'info',
          );
        }

        // Brief pause so the toast registers, then go back to the operator's
        // default screen.
        window.setTimeout(() => {
          if (user) navigate(defaultPathForRole(user.role));
        }, 900);
      } else {
        pushToast(
          `Payment of ${formatMoney(result.payment.amount)} recorded · ${formatMoney(
            Number(result.order.total) - netPaidFromPayments(result.order.payments ?? []),
          )} remaining`,
          'success',
        );
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Payment failed';
      pushToast(msg, 'error');
    },
  });

  // ── Keyboard shortcuts (must be called unconditionally). Enter → submit,
  //    Escape → back to order.
  useKeyboardShortcut('Escape', () => {
    if (order?.status !== 'PAID') navigate(`/orders/${id}`);
    else if (user) navigate(defaultPathForRole(user.role));
  });
  useKeyboardShortcut('Enter', () => {
    if (canSubmit && !payMutation.isPending) payMutation.mutate();
  });

  // ── Role gate ──────────────────────────────────────────────────────
  if (!user) return null;
  if (!ROLE_CAN_PAY.includes(user.role)) {
    return (
      <div className="empty">
        <div className="icon">🔒</div>
        <div className="title">Cashier access required</div>
        <div>Only cashiers and admins can process payments.</div>
        <button
          type="button"
          className="btn btn-ghost btn-lg"
          onClick={() => navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </div>
    );
  }

  if (orderQuery.isLoading) {
    return (
      <div className="empty">
        <div className="title">Loading order…</div>
      </div>
    );
  }

  if (!order || orderQuery.error) {
    return (
      <div className="empty">
        <div className="icon">!</div>
        <div className="title">Could not load order</div>
        <div>{(orderQuery.error as Error | undefined)?.message ?? 'Order not found'}</div>
        <button
          type="button"
          className="btn btn-ghost btn-lg"
          onClick={() => navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </div>
    );
  }

  // ── Numpad handlers. Entries append as minor units so "1"+"0"+"0" = $1.00,
  // a common convention on POS terminals that avoids a decimal-point key.
  const MAX_CENTAVOS = 100_000_00; // $100,000 cap — no café bill should approach this
  function appendDigit(d: string) {
    if (payMutation.isPending) return;
    const next = amountCentavos * 10 + Number(d);
    if (next > MAX_CENTAVOS) return;
    setAmountCentavos(next);
  }
  function backspace() {
    if (payMutation.isPending) return;
    setAmountCentavos((v) => Math.floor(v / 10));
  }
  function clearAmount() {
    if (payMutation.isPending) return;
    setAmountCentavos(0);
  }
  function quickCash(value: number) {
    if (payMutation.isPending) return;
    setAmountCentavos(value);
  }

  return (
    <div className="pay-page">
      {/* ── Left: order summary ──────────────────────── */}
      <section className="pay-summary">
        <header className="pay-summary-head">
          <div>
            <div className="crumb">Payment</div>
            <h1>
              <span className="order-hash">#</span>
              {order.order_number}
            </h1>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(`/orders/${order.id}`)}
            disabled={isPaid}
          >
            ← Back to order
          </button>
        </header>
        <div className="pay-summary-meta">
          <span className={`order-type ${order.order_type === 'TAKEOUT' ? 'takeout' : ''}`}>
            {order.order_type === 'DINE_IN' ? 'Dine In' : 'Takeout'}
          </span>
          <span className="text-mute">
            {order.table
              ? `${order.table.zone.name} · Table ${order.table.number}`
              : 'Takeout'}
          </span>
          <span className="text-mute">· {order.user.name}</span>
        </div>

        <div className="pay-items">
          {order.items.map((it) => (
            <div key={it.id} className="pay-item">
              <div className="pay-item-row">
                <span className="qty">{it.quantity}×</span>
                <span className="name">
                  {it.product.name}
                  {it.variant && <span className="variant"> · {it.variant.name}</span>}
                </span>
                <span className="amount">{formatMoney(it.line_total)}</span>
              </div>
              {it.modifiers.length > 0 && (
                <div className="pay-item-mods">
                  {it.modifiers.map((m) => (
                    <div key={m.id} className="pay-item-mod">
                      <span>· {m.name}</span>
                      {Number(m.extra_price) > 0 && (
                        <span>+{formatMoney(m.extra_price)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pay-totals">
          <div className="row">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          <div className="row">
            <span>Tax</span>
            <span>{formatMoney(order.tax_amount)}</span>
          </div>
          {Number(order.discount_amount) > 0 && (
            <div className="row">
              <span>Discount</span>
              <span>-{formatMoney(order.discount_amount)}</span>
            </div>
          )}
          <div className="row total">
            <span>Total</span>
            <span>{formatMoney(order.total)}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="pay-payments">
            <div className="section-title">Payments</div>
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </section>

      {/* ── Right: tender panel ──────────────────────── */}
      <aside className="pay-panel">
        <div className="pay-headline">
          <div className="pay-row">
            <span className="pay-row-label">Total</span>
            <span className="pay-row-value">{formatMoney(total)}</span>
          </div>
          {paidNet > 0 && (
            <div className="pay-row">
              <span className="pay-row-label">Paid</span>
              <span className="pay-row-value">{formatMoney(paidNet)}</span>
            </div>
          )}
          <div className="pay-row pay-row-remaining">
            <span className="pay-row-label">Remaining</span>
            <span className="pay-row-value">{formatMoney(remaining)}</span>
          </div>
        </div>

        {isPaid ? (
          <div className="pay-done">
            <div className="icon">✓</div>
            <div className="title">Order paid</div>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => navigate(defaultPathForRole(user.role))}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="method-toggle">
              {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`method-btn ${method === m ? 'active' : ''}`}
                  onClick={() => {
                    setMethod(m);
                    // Non-cash tenders must match remaining exactly; preselect
                    // that so the cashier doesn't have to retype it.
                    if (m !== 'CASH') setAmountCentavos(remaining);
                  }}
                  disabled={payMutation.isPending}
                >
                  {m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : 'Transfer'}
                </button>
              ))}
            </div>

            <div className="amount-display">
              <span className="label">Amount</span>
              <span className="value">{formatMoney(amountCentavos)}</span>
            </div>

            {method === 'CASH' && (
              <div className="quick-cash">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => quickCash(remaining)}
                  disabled={payMutation.isPending || remaining === 0}
                >
                  Exact
                </button>
                {QUICK_CASH_AMOUNTS.map((cents) => (
                  <button
                    key={cents}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => quickCash(cents)}
                    disabled={payMutation.isPending}
                  >
                    {formatMoney(cents)}
                  </button>
                ))}
              </div>
            )}

            {method !== 'CASH' && (
              <label className="ref-field">
                <span>Reference (optional)</span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Transaction ID, last 4 digits…"
                  maxLength={200}
                  disabled={payMutation.isPending}
                />
              </label>
            )}

            <div className="pay-numpad-wrap">
              <Numpad
                onDigit={appendDigit}
                onClear={clearAmount}
                onBackspace={backspace}
                disabled={payMutation.isPending}
              />
            </div>

            {method === 'CASH' && cashChange > 0 && (
              <div className="change-row">
                <span>Change</span>
                <span className="change-value">{formatMoney(cashChange)}</span>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn-xl btn-block"
              disabled={!canSubmit || payMutation.isPending}
              onClick={() => payMutation.mutate()}
            >
              {payMutation.isPending
                ? 'Processing…'
                : method === 'CASH' && amountCentavos >= remaining
                  ? `Complete · ${formatMoney(amountCentavos)}`
                  : `Charge ${formatMoney(amountCentavos)}`}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const methodLabel =
    payment.method === 'CASH' ? 'Cash' : payment.method === 'CARD' ? 'Card' : 'Transfer';
  return (
    <div className="payment-row">
      <span className="method">{methodLabel}</span>
      <span className="amount">{formatMoney(payment.amount)}</span>
      {Number(payment.change_amount) > 0 && (
        <span className="change text-mute">
          (change {formatMoney(payment.change_amount)})
        </span>
      )}
    </div>
  );
}

// Net paid across a list of payments, honoring change given on cash tenders.
// Duplicated from the main component so the success toast can compute the
// new remaining without going through useMemo state.
function netPaidFromPayments(payments: Payment[]): number {
  return payments.reduce(
    (sum, p) => sum + Number(p.amount) - Number(p.change_amount),
    0,
  );
}

// Hand a receipt to the Electron bridge. Returns a uniform shape so the
// caller always gets a toast-worthy message whether we're running in Electron,
// a plain browser (UI dev), or the printer hardware errored.
async function printReceipt(
  order: ActiveOrder,
  settings: SettingsMap,
): Promise<{ ok: boolean; message?: string }> {
  if (!window.electron) {
    return { ok: false, message: 'Running outside Electron — nothing printed' };
  }
  try {
    const payload = {
      business: {
        name: settings[TERMINAL_SETTING_KEYS.BUSINESS_NAME] || 'Restaurant POS',
        address: settings[TERMINAL_SETTING_KEYS.BUSINESS_ADDRESS] || undefined,
      },
      order_number: order.order_number,
      date: new Date(order.updated_at).toLocaleString(),
      cashier: order.user.name,
      table: order.table
        ? { zone: order.table.zone.name, number: order.table.number }
        : null,
      items: order.items.map((it) => ({
        quantity: it.quantity,
        name: it.product.name,
        variant: it.variant?.name ?? null,
        line_total: it.line_total,
        modifiers: it.modifiers.map((m) => ({
          name: m.name,
          extra_price: m.extra_price,
        })),
      })),
      subtotal: order.subtotal,
      tax_amount: order.tax_amount,
      total: order.total,
      payments: (order.payments ?? []).map((p) => ({
        method: p.method === 'CASH' ? 'Cash' : p.method === 'CARD' ? 'Card' : 'Transfer',
        amount: p.amount,
        change_amount: p.change_amount,
      })),
    };
    return await window.electron.printReceipt(payload);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Print bridge error' };
  }
}
