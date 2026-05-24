// Suggested Changes — manager+ workspace that surfaces every pending
// cashier proposal in one place. Two families share the screen: order edits
// (reopen / delete / change-method) and catalog edits (table / product
// CRUD). Both wire through PinConfirmModal so a fresh manager PIN gates
// every approve and reject.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../api/client';
import {
  approveOrderSuggestion,
  listOrderSuggestions,
  rejectOrderSuggestion,
  type OrderSuggestionListItem,
} from '../../../api/orders';
import {
  approveSuggestion,
  listSuggestions,
  rejectSuggestion,
  type Suggestion,
  type SuggestionStatus,
} from '../../../api/suggestions';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';
import { Spinner } from '../../Spinner';
import { PinConfirmModal } from '../../PinConfirmModal';
import { AdminViewShell } from './AdminViewShell';
import { formatMoney } from '../../../utils/format';

interface SuggestedChangesViewProps {
  onBack: () => void;
}

type StatusTab = SuggestionStatus;

const STATUS_TABS: Array<{ id: StatusTab; labelKey: TranslationKey }> = [
  { id: 'PENDING', labelKey: 'settings.suggestionFilterPending' },
  { id: 'APPROVED', labelKey: 'settings.suggestionFilterApproved' },
  { id: 'REJECTED', labelKey: 'settings.suggestionFilterRejected' },
];

// Mixed-source row. Keeps the renderer simple by collapsing the two API
// payloads into a small shared shape; specifics (the order snapshot, target
// table / product) are surfaced by the typed `kind` discriminator.
type MixedRow =
  | { kind: 'order'; row: OrderSuggestionListItem }
  | { kind: 'catalog'; row: Suggestion };

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16 },
  tabRow: { display: 'flex', gap: 6 },
  tab: {
    padding: '8px 16px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
  },
  empty: {
    padding: '48px 16px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    color: 'var(--text2)',
    gap: 10,
  },
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '16px 18px',
  },
  cardOrder: {
    boxShadow: 'inset 3px 0 0 var(--gold)',
  },
  cardCatalog: {
    boxShadow: 'inset 3px 0 0 var(--green)',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  typePill: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '3px 9px',
    borderRadius: 999,
    background: 'rgba(201,164,92,0.16)',
    color: '#8a6d2a',
  },
  typePillCatalog: {
    background: 'rgba(74,140,92,0.16)',
    color: 'var(--green)',
  },
  summary: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text1)',
    flex: 1,
    minWidth: 0,
  },
  meta: { fontSize: 12, color: 'var(--text2)' },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 12,
    marginTop: 8,
    fontSize: 13,
    color: 'var(--text2)',
  },
  reason: {
    fontSize: 13,
    color: 'var(--text1)',
    fontStyle: 'italic',
    paddingLeft: 10,
    borderLeft: '2px solid var(--border)',
    marginTop: 10,
  },
  payload: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    color: 'var(--text2)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginTop: 10,
    maxHeight: 140,
    overflowY: 'auto',
  },
  reviewLine: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 8,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 14,
  },
  approveBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--green)',
    color: '#fff',
    border: '1px solid var(--green)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  rejectBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--red)',
    border: '1px solid var(--red)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  errBanner: {
    marginTop: 10,
    padding: '8px 12px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.35)',
    color: 'var(--red)',
    fontSize: 12,
  },
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  ...styles.tab,
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
});

// PIN modal target. Captures which row + which action so the same modal
// handles both order and catalog suggestions without branching at the
// callsite.
type PinTarget =
  | { kind: 'order-approve'; row: OrderSuggestionListItem }
  | { kind: 'order-reject'; row: OrderSuggestionListItem }
  | { kind: 'catalog-approve'; row: Suggestion }
  | { kind: 'catalog-reject'; row: Suggestion };

export function SuggestedChangesView({ onBack }: SuggestedChangesViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusTab>('PENDING');
  const [pinTarget, setPinTarget] = useState<PinTarget | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const orderQuery = useQuery({
    queryKey: ['order-suggestions', status],
    queryFn: () => listOrderSuggestions(status),
    refetchInterval: 30_000,
  });
  const catalogQuery = useQuery({
    queryKey: ['suggestions', status],
    queryFn: () => listSuggestions({ status, limit: 100 }),
    refetchInterval: 30_000,
  });

  // Merge + sort by created_at desc so the most recently submitted item
  // tops the list regardless of which family it belongs to.
  const merged = useMemo<MixedRow[]>(() => {
    const items: MixedRow[] = [];
    for (const r of orderQuery.data ?? []) items.push({ kind: 'order', row: r });
    for (const r of catalogQuery.data?.items ?? []) items.push({ kind: 'catalog', row: r });
    items.sort((a, b) => {
      const at = new Date(a.row.created_at).getTime();
      const bt = new Date(b.row.created_at).getTime();
      return bt - at;
    });
    return items;
  }, [orderQuery.data, catalogQuery.data]);

  const isLoading = orderQuery.isLoading || catalogQuery.isLoading;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['order-suggestions'] });
    queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['floors'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const approveOrderMut = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      approveOrderSuggestion(id, { pin }),
    onSuccess: () => { setPinTarget(null); setPinError(null); invalidate(); },
    onError: (e) =>
      setPinError(e instanceof ApiError ? e.message : t('common.unknownError')),
  });
  const rejectOrderMut = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      rejectOrderSuggestion(id, { pin }),
    onSuccess: () => { setPinTarget(null); setPinError(null); invalidate(); },
    onError: (e) =>
      setPinError(e instanceof ApiError ? e.message : t('common.unknownError')),
  });
  const approveCatalogMut = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      approveSuggestion(id, pin),
    onSuccess: () => { setPinTarget(null); setPinError(null); invalidate(); },
    onError: (e) =>
      setPinError(e instanceof ApiError ? e.message : t('common.unknownError')),
  });
  const rejectCatalogMut = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      rejectSuggestion(id, pin),
    onSuccess: () => { setPinTarget(null); setPinError(null); invalidate(); },
    onError: (e) =>
      setPinError(e instanceof ApiError ? e.message : t('common.unknownError')),
  });

  const pinBusy =
    approveOrderMut.isPending ||
    rejectOrderMut.isPending ||
    approveCatalogMut.isPending ||
    rejectCatalogMut.isPending;

  function closePin() {
    setPinTarget(null);
    setPinError(null);
    approveOrderMut.reset();
    rejectOrderMut.reset();
    approveCatalogMut.reset();
    rejectCatalogMut.reset();
  }

  function onPinConfirm(pin: string) {
    if (!pinTarget) return;
    switch (pinTarget.kind) {
      case 'order-approve':
        approveOrderMut.mutate({ id: pinTarget.row.id, pin });
        return;
      case 'order-reject':
        rejectOrderMut.mutate({ id: pinTarget.row.id, pin });
        return;
      case 'catalog-approve':
        approveCatalogMut.mutate({ id: pinTarget.row.id, pin });
        return;
      case 'catalog-reject':
        rejectCatalogMut.mutate({ id: pinTarget.row.id, pin });
        return;
    }
  }

  const pinModalTitle = (() => {
    if (!pinTarget) return '';
    return pinTarget.kind.endsWith('approve')
      ? t('history.approveTitle')
      : t('history.rejectTitle');
  })();
  const pinModalConfirm = (() => {
    if (!pinTarget) return '';
    return pinTarget.kind.endsWith('approve')
      ? t('history.approveConfirm')
      : t('history.rejectConfirm');
  })();

  return (
    <AdminViewShell
      titleKey="admin.tile.suggestedChanges"
      subtitleKey="admin.suggestedChanges.subtitle"
      onBack={onBack}
    >
      <div style={styles.root}>
        <div style={styles.tabRow}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              style={tabStyle(status === tab.id)}
              onClick={() => setStatus(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {isLoading && (
          <div style={styles.loading}>
            <Spinner size={16} />
            <span>{t('common.loading')}…</span>
          </div>
        )}

        {!isLoading && merged.length === 0 && (
          <div style={styles.empty}>
            {t('admin.suggestedChanges.empty')}
          </div>
        )}

        {!isLoading && merged.map((m) => (
          m.kind === 'order' ? (
            <OrderSuggestionCard
              key={`o-${m.row.id}`}
              row={m.row}
              isPending={status === 'PENDING'}
              onApprove={() => { setPinError(null); setPinTarget({ kind: 'order-approve', row: m.row }); }}
              onReject={() => { setPinError(null); setPinTarget({ kind: 'order-reject', row: m.row }); }}
            />
          ) : (
            <CatalogSuggestionCard
              key={`c-${m.row.id}`}
              row={m.row}
              isPending={status === 'PENDING'}
              onApprove={() => { setPinError(null); setPinTarget({ kind: 'catalog-approve', row: m.row }); }}
              onReject={() => { setPinError(null); setPinTarget({ kind: 'catalog-reject', row: m.row }); }}
            />
          )
        ))}
      </div>

      {pinTarget && (
        <PinConfirmModal
          title={pinModalTitle}
          confirmLabel={pinModalConfirm}
          busy={pinBusy}
          error={pinError}
          onClose={closePin}
          onConfirm={onPinConfirm}
        />
      )}
    </AdminViewShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Order suggestion card — proposed reopen / delete / change-method on a
// specific order. Highlights the gold rail so reviewers see at a glance
// these touch real money.
// ────────────────────────────────────────────────────────────────────────────

interface OrderSuggestionCardProps {
  row: OrderSuggestionListItem;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}
function OrderSuggestionCard({ row, isPending, onApprove, onReject }: OrderSuggestionCardProps) {
  const { t } = useTranslation();
  const payload = row.payload ?? {};

  const typeLabel = (() => {
    switch (row.type) {
      case 'ORDER_REOPEN':  return t('history.suggestionTypeReopen');
      case 'ORDER_DELETE':  return t('history.suggestionTypeDelete');
      case 'ORDER_CHANGE_PAYMENT': {
        const method = String(payload.method ?? '').toLowerCase();
        const methodLabel =
          method === 'cash' ? t('payment.cash')
            : method === 'card' ? t('payment.card')
            : method === 'transfer' ? t('payment.transfer')
            : String(payload.method ?? '—');
        return t('history.suggestionTypeChangeMethod').replace('{method}', methodLabel);
      }
    }
  })();

  const reason = typeof payload.reason === 'string' ? payload.reason : null;
  const orderLabel = row.order
    ? `#${row.order.order_number} · ${formatMoney(row.order.total)}`
    : t('admin.suggestedChanges.orderMissing');

  return (
    <div style={{ ...styles.card, ...styles.cardOrder }}>
      <div style={styles.cardHead}>
        <span style={styles.typePill}>{t('admin.suggestedChanges.tagOrder')}</span>
        <strong style={styles.summary}>{typeLabel}</strong>
        <span style={styles.meta}>{orderLabel}</span>
      </div>
      <div style={styles.meta}>
        {t('settings.suggestionBy')} {row.creator.name} ·{' '}
        {new Date(row.created_at).toLocaleString()}
      </div>
      {reason && (
        <div style={styles.reason}>
          {t('history.suggestionReasonLine').replace('{reason}', reason)}
        </div>
      )}
      {row.note && (
        <div style={styles.reason}>{row.note}</div>
      )}

      {isPending && (
        <div style={styles.actions}>
          <button type="button" style={styles.approveBtn} onClick={onApprove}>
            {t('history.suggestionApprove')}
          </button>
          <button type="button" style={styles.rejectBtn} onClick={onReject}>
            {t('history.suggestionReject')}
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Catalog suggestion card — wraps the existing TABLE_* / PRODUCT_* flow.
// Uses the green rail so reviewers can distinguish at a glance from order
// edits which touch live money.
// ────────────────────────────────────────────────────────────────────────────

interface CatalogSuggestionCardProps {
  row: Suggestion;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}
function CatalogSuggestionCard({ row, isPending, onApprove, onReject }: CatalogSuggestionCardProps) {
  const { t } = useTranslation();
  const tablePrefix = t('orders.tablePrefix');

  const summary = (() => {
    switch (row.type) {
      case 'TABLE_CREATE': {
        const p = row.payload as { number?: number };
        return `${t('settings.suggestionTypeTableCreate')}${p.number ? ` #${p.number}` : ''}`;
      }
      case 'TABLE_UPDATE':
        return `${t('settings.suggestionTypeTableUpdate')} ${row.table?.label || `${tablePrefix} ${row.table?.number ?? '—'}`}`;
      case 'TABLE_DELETE':
        return `${t('settings.suggestionTypeTableDelete')} ${row.table?.label || `${tablePrefix} ${row.table?.number ?? '—'}`}`;
      case 'PRODUCT_CREATE': {
        const p = row.payload as { name?: string };
        return `${t('settings.suggestionTypeProductCreate')}${p.name ? ` "${p.name}"` : ''}`;
      }
      case 'PRODUCT_UPDATE':
        return `${t('settings.suggestionTypeProductUpdate')} "${row.product?.name ?? '—'}"`;
      case 'PRODUCT_DELETE':
        return `${t('settings.suggestionTypeProductDelete')} "${row.product?.name ?? '—'}"`;
    }
  })();

  return (
    <div style={{ ...styles.card, ...styles.cardCatalog }}>
      <div style={styles.cardHead}>
        <span style={{ ...styles.typePill, ...styles.typePillCatalog }}>
          {t('admin.suggestedChanges.tagCatalog')}
        </span>
        <strong style={styles.summary}>{summary}</strong>
        <span style={styles.meta}>
          {t('settings.suggestionBy')} {row.creator.name} ·{' '}
          {new Date(row.created_at).toLocaleString()}
        </span>
      </div>
      {row.note && <div style={styles.reason}>{row.note}</div>}
      <pre style={styles.payload}>
        {JSON.stringify(row.payload, null, 2)}
      </pre>
      {!isPending && row.reviewer && (
        <div style={styles.reviewLine}>
          {row.status === 'APPROVED'
            ? t('settings.suggestionApproved')
            : t('settings.suggestionRejected')}{' '}
          {t('settings.suggestionBy')} {row.reviewer.name}
          {row.reviewed_at &&
            ` · ${new Date(row.reviewed_at).toLocaleString()}`}
          {row.review_note && ` — "${row.review_note}"`}
        </div>
      )}
      {isPending && (
        <div style={styles.actions}>
          <button type="button" style={styles.approveBtn} onClick={onApprove}>
            {t('settings.suggestionApprove')}
          </button>
          <button type="button" style={styles.rejectBtn} onClick={onReject}>
            {t('settings.suggestionReject')}
          </button>
        </div>
      )}
    </div>
  );
}
