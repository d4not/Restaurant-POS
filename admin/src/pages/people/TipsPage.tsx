import { useMemo, useState } from 'react';
import { Badge, Button, Card, KPICard, Modal } from '../../components/ui';
import { TipAllocationTable } from '../../components/people/TipAllocationTable';
import {
  useCloseTipPool,
  useCurrentTipPool,
  useRefreshTipPool,
  useReopenTipPool,
  useTipPool,
  useTipPools,
} from '../../hooks/useTips';
import type { TipPool, TipPoolStatus } from '../../types/people';
import { formatDate, formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';

function statusTone(s: TipPoolStatus) {
  return s === 'OPEN' ? 'gold' as const : 'gray' as const;
}

function statusLabel(s: TipPoolStatus, t: (k: string) => string) {
  return s === 'OPEN' ? t('people.tips.statusOpen') : t('people.tips.statusClosed');
}

export function TipsPage() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === 'MANAGER' || role === 'ADMIN';

  // The page can show two things: the (open) current pool or a historical
  // pool selected from the history list. They share the same render path.
  const [historyId, setHistoryId] = useState<string | null>(null);
  const currentQ = useCurrentTipPool();
  const historyPoolQ = useTipPool(historyId ?? undefined);
  const focused: TipPool | undefined = historyId
    ? historyPoolQ.data
    : currentQ.data;

  const refreshM = useRefreshTipPool();
  const closeM = useCloseTipPool();
  const reopenM = useReopenTipPool();

  const [confirm, setConfirm] = useState<'close' | 'reopen' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const historyQ = useTipPools({ status: 'CLOSED' });
  const history = useMemo(
    () => historyQ.data?.pages.flatMap((p) => p.items) ?? [],
    [historyQ.data],
  );

  const onRefresh = async () => {
    if (!focused) return;
    setError(null);
    try {
      await refreshM.mutateAsync(focused.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh');
    }
  };

  const onClose = async () => {
    if (!focused) return;
    setError(null);
    try {
      await closeM.mutateAsync(focused.id);
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close');
    }
  };

  const onReopen = async () => {
    if (!focused) return;
    setError(null);
    try {
      await reopenM.mutateAsync(focused.id);
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen');
    }
  };

  return (
    <>
      <Card>
        <div className="flex-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('people.tips.title')}</h1>
            <div className="fs-13 text-muted">{t('people.tips.subtitle')}</div>
          </div>
          {historyId && (
            <Button variant="ghost" onClick={() => setHistoryId(null)}>
              ← {t('people.tips.currentPool')}
            </Button>
          )}
        </div>
      </Card>

      {/* ── Focused pool ── */}
      <div style={{ marginTop: 16 }}>
        <Card>
          {(currentQ.isLoading && !historyId) ||
          (historyPoolQ.isLoading && historyId) ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : !focused ? (
            <div className="fs-12 text-muted">{t('common.noResults')}</div>
          ) : (
            <>
              <div
                className="flex-between"
                style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "'Playfair Display', serif",
                      fontSize: 18,
                      fontWeight: 600,
                    }}
                  >
                    {t('people.tips.currentPool')} ·{' '}
                    {formatDate(focused.week_start)} – {formatDate(focused.week_end)}
                  </div>
                  <div className="fs-12 text-muted mt-4">
                    <Badge tone={statusTone(focused.status)}>
                      {statusLabel(focused.status, t)}
                    </Badge>
                    {focused.closer && focused.closed_at && (
                      <span style={{ marginLeft: 10 }}>
                        {formatDate(focused.closed_at)} · {focused.closer.name}
                      </span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {focused.status === 'OPEN' && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={onRefresh}
                          loading={refreshM.isPending}
                        >
                          {t('people.tips.refresh')}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => setConfirm('close')}
                          loading={closeM.isPending}
                        >
                          {t('people.tips.close')}
                        </Button>
                      </>
                    )}
                    {focused.status === 'CLOSED' && (
                      <Button
                        variant="danger"
                        onClick={() => setConfirm('reopen')}
                        loading={reopenM.isPending}
                      >
                        {t('people.tips.reopen')}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="kpi-grid" style={{ marginTop: 16, marginBottom: 16 }}>
                <KPICard
                  label={t('people.tips.totalCollected')}
                  value={formatMoney(Number(focused.total_collected))}
                  valueColor="gold"
                />
                <KPICard
                  label={t('people.tips.totalDistributed')}
                  value={formatMoney(Number(focused.total_distributed))}
                />
                <KPICard
                  label={t('people.tips.includedCount')}
                  value={focused.allocations.filter((a) => a.included).length}
                />
              </div>

              {error && (
                <div className="auth-alert" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              )}

              <TipAllocationTable pool={focused} />
            </>
          )}
        </Card>
      </div>

      {/* ── History list ── */}
      <div style={{ marginTop: 16 }}>
        <Card title={t('people.tips.history.title')}>
          {historyQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : history.length === 0 ? (
            <div className="fs-12 text-muted">{t('people.tips.history.empty')}</div>
          ) : (
            <div className="table-wrap">
              <div
                className="table-head"
                style={{ gridTemplateColumns: '1fr 140px 140px 110px 80px', columnGap: 12 }}
              >
                <div>{t('common.date')}</div>
                <div>{t('people.tips.totalCollected')}</div>
                <div>{t('people.tips.totalDistributed')}</div>
                <div>{t('common.status')}</div>
                <div />
              </div>
              {history.map((pool, idx) => (
                <div
                  key={pool.id}
                  className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                  style={{
                    gridTemplateColumns: '1fr 140px 140px 110px 80px',
                    columnGap: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => setHistoryId(pool.id)}
                >
                  <div className="fs-13">
                    {formatDate(pool.week_start)} – {formatDate(pool.week_end)}
                  </div>
                  <div className="fs-13">{formatMoney(Number(pool.total_collected))}</div>
                  <div className="fs-13">{formatMoney(Number(pool.total_distributed))}</div>
                  <div>
                    <Badge tone={statusTone(pool.status)}>
                      {statusLabel(pool.status, t)}
                    </Badge>
                  </div>
                  <div>
                    <Button variant="ghost" size="sm">
                      {t('common.actions')} →
                    </Button>
                  </div>
                </div>
              ))}
              {historyQ.hasNextPage && (
                <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={historyQ.isFetchingNextPage}
                    onClick={() => historyQ.fetchNextPage()}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={confirm === 'close'}
        onClose={() => setConfirm(null)}
        size="sm"
        title={t('people.tips.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={closeM.isPending}
              onClick={onClose}
            >
              {t('people.tips.close')}
            </Button>
          </>
        }
      >
        <p className="fs-13">{t('people.tips.closeConfirm')}</p>
      </Modal>

      <Modal
        open={confirm === 'reopen'}
        onClose={() => setConfirm(null)}
        size="sm"
        title={t('people.tips.reopen')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={reopenM.isPending}
              onClick={onReopen}
            >
              {t('people.tips.reopen')}
            </Button>
          </>
        }
      >
        <p className="fs-13">{t('people.tips.reopenConfirm')}</p>
      </Modal>
    </>
  );
}
