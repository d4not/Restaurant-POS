import type { Purchase, PurchaseStatus } from '../../types/inventory';
import { useTranslation } from '../../i18n';
import {
  DELIVERY_FLOW,
  ERRAND_FLOW,
  flowFor,
  isTerminal,
  STATUS_I18N_KEY,
} from './status';

interface Props {
  purchase: Purchase;
}

interface Milestone {
  status: PurchaseStatus;
  reachedAt: string | null;
  actor: string | null;
  note: string | null;
}

// Per-status fact extractor — pulls the audit timestamp + responsible user
// + tiny note ("$X advanced", "ref TRF-1234") for the timeline entry. Keeping
// this in one place lets the component stay declarative.
function extractMilestone(p: Purchase, status: PurchaseStatus): Milestone {
  switch (status) {
    case 'DRAFT':
      return {
        status,
        reachedAt: p.created_at,
        actor: p.user?.name ?? null,
        note: null,
      };
    case 'SENT_TO_SUPPLIER':
      return { status, reachedAt: p.message_sent_at, actor: null, note: null };
    case 'SUPPLIER_REPLIED':
      return {
        status,
        reachedAt: p.supplier_replied_at,
        actor: null,
        note:
          p.supplier_subtotal != null
            ? `subtotal $${(Number(p.supplier_subtotal) / 100).toFixed(2)}`
            : null,
      };
    case 'PAID':
      return {
        status,
        reachedAt: p.paid_at,
        actor: null,
        note: p.payment_reference ? `ref ${p.payment_reference}` : null,
      };
    case 'IN_TRANSIT':
      return {
        status,
        reachedAt: p.in_transit_at,
        actor: null,
        note: p.expected_arrival
          ? `ETA ${new Date(p.expected_arrival).toLocaleDateString()}`
          : null,
      };
    case 'ARRIVED':
      return { status, reachedAt: p.arrived_at, actor: null, note: null };
    case 'DISPATCHED':
      return {
        status,
        reachedAt: p.dispatched_at,
        actor: p.runner?.name ?? null,
        note:
          p.cash_advanced != null
            ? `$${(Number(p.cash_advanced) / 100).toFixed(2)} entregados`
            : null,
      };
    case 'RETURNED':
      return {
        status,
        reachedAt: p.returned_at,
        actor: null,
        note:
          p.cash_returned != null
            ? `cambio $${(Number(p.cash_returned) / 100).toFixed(2)}`
            : null,
      };
    case 'VERIFIED':
      return {
        status,
        reachedAt: p.verified_at,
        actor: p.verifier?.name ?? null,
        note: null,
      };
    case 'CANCELLED':
    case 'REJECTED':
      return {
        status,
        reachedAt: p.cancelled_at,
        actor: p.canceller?.name ?? null,
        note: p.cancel_reason ?? null,
      };
    default:
      return { status, reachedAt: null, actor: null, note: null };
  }
}

export function StatusTimeline({ purchase }: Props) {
  const { t } = useTranslation();
  const flow = flowFor(purchase.kind);
  const currentIndex = flow.indexOf(purchase.status);

  const milestones = flow.map((status) => extractMilestone(purchase, status));

  // Render terminal cancel/reject as a tail-end marker so the operator sees
  // *where* the flow died — drawing it before the dead state confused testers.
  const terminalCancel =
    isTerminal(purchase.status) && (purchase.status === 'CANCELLED' || purchase.status === 'REJECTED')
      ? extractMilestone(purchase, purchase.status)
      : null;

  return (
    <ol className="po-timeline" aria-label={t('po.timeline.label')}>
      {milestones.map((m, idx) => {
        const reached = currentIndex >= 0 && idx <= currentIndex;
        const current = currentIndex === idx;
        return (
          <li
            key={m.status}
            className={`po-timeline-step${reached ? ' reached' : ''}${current ? ' current' : ''}`}
          >
            <span className="po-timeline-dot" aria-hidden>
              {current ? '●' : reached ? '✓' : ''}
            </span>
            <div className="po-timeline-body">
              <div className="po-timeline-label">{t(STATUS_I18N_KEY[m.status])}</div>
              <div className="po-timeline-meta">
                {m.reachedAt && (
                  <span className="po-timeline-time">
                    {new Date(m.reachedAt).toLocaleString()}
                  </span>
                )}
                {m.actor && <span className="po-timeline-actor">{m.actor}</span>}
                {m.note && <span className="po-timeline-note">{m.note}</span>}
              </div>
            </div>
          </li>
        );
      })}
      {terminalCancel && (
        <li className="po-timeline-step terminal cancelled">
          <span className="po-timeline-dot" aria-hidden>
            ✕
          </span>
          <div className="po-timeline-body">
            <div className="po-timeline-label">{t(STATUS_I18N_KEY[terminalCancel.status])}</div>
            <div className="po-timeline-meta">
              {terminalCancel.reachedAt && (
                <span className="po-timeline-time">
                  {new Date(terminalCancel.reachedAt).toLocaleString()}
                </span>
              )}
              {terminalCancel.actor && (
                <span className="po-timeline-actor">{terminalCancel.actor}</span>
              )}
              {terminalCancel.note && (
                <span className="po-timeline-note">{terminalCancel.note}</span>
              )}
            </div>
          </div>
        </li>
      )}
    </ol>
  );
}

// Re-export the flow constants for the action panel, which switches the
// "next action" CTA based on lifecycle position.
export { DELIVERY_FLOW, ERRAND_FLOW };
