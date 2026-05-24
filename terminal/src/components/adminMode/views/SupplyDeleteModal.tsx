// Supply · Delete — confirmation overlay with dependency counts.
//
// The full cascade-resolver UI (per-product action: replace supply / remove
// line / delete product, with adjustable replacement quantity) is on the
// roadmap. This first pass surfaces the *counts* so the operator at least
// knows what damage a soft-delete will do — recipes will keep a broken
// reference, modifiers will lose their supply, and stock-bearing storages
// will need a write-off for a clean shutdown.
//
// Backend touch points
//   GET    /api/v1/supplies/:id/dependencies — counts + last movement
//   DELETE /api/v1/supplies/:id              — soft-delete (deactivate)

import { useEffect, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api, ApiError } from '../../../api/client';
import { IconClose } from '../../Icons';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Dependencies {
  recipe_count: number;
  product_count: number;
  modifier_count: number;
  storages_with_stock: number;
  total_stock: string;
  last_movement_at: string | null;
}

interface Props {
  supplyId: string;
  supplyName: string;
  onClose: () => void;
  onDeleted: (msg: string) => void;
  onError: (msg: string) => void;
  // Triggered when the operator chooses to resolve dependencies per recipe
  // instead of soft-deleting blindly. The parent swaps this modal for the
  // cascade resolver.
  onResolveCascade: () => void;
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

async function fetchDependencies(id: string): Promise<Dependencies> {
  return api.get<Dependencies>(`/supplies/${id}/dependencies`);
}

// ─── Display helpers ────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

function formatRelativeDate(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyDeleteModal({
  supplyId,
  supplyName,
  onClose,
  onDeleted,
  onError,
  onResolveCascade,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Esc closes the modal. We mark the event as defaultPrevented so the
  // surrounding AdminViewShell doesn't also pop back out of the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const deleteMut = useMutation({
    mutationFn: async () => api.delete(`/supplies/${supplyId}`),
    onSuccess: () => {
      onDeleted(t('admin.supplyDelete.success'));
      // Drop the dependencies cache before invalidating the broader supplies
      // prefix: getSupplyDependencies 404s once the row is soft-deleted, so a
      // prefix-match refetch would surface a noisy "Not Found" in the console.
      queryClient.removeQueries({
        queryKey: ['admin', 'supplies', supplyId, 'dependencies'],
        exact: true,
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'supplies'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.supplyDelete.failed');
      onError(msg);
    },
  });

  // Gated on !deleteMut.isSuccess so we don't refetch against the freshly
  // soft-deleted supply (the backend's getSupplyDependencies throws NotFound
  // for deleted rows).
  const depsQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'dependencies'],
    queryFn: () => fetchDependencies(supplyId),
    enabled: !deleteMut.isSuccess,
    staleTime: 0,
  });

  const deps = depsQuery.data ?? null;
  const hasStock = deps !== null && deps.storages_with_stock > 0;
  const hasRecipes = deps !== null && deps.recipe_count > 0;
  const hasModifiers = deps !== null && deps.modifier_count > 0;
  const anyWarning = hasStock || hasRecipes || hasModifiers;

  return (
    <div style={scrim} onClick={onClose}>
      <div
        style={card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supply-delete-title"
      >
        {/* Head */}
        <header style={head}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="supply-delete-title" style={title}>
              {t('admin.supplyDelete.title')}
            </h2>
            <p style={subtitle}>{supplyName}</p>
            <p style={lead}>{t('admin.supplyDelete.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeBtn}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </header>

        {/* Body */}
        <div style={body}>
          {depsQuery.isLoading && (
            <div style={loaderWrap}>
              <Spinner />
              <span style={loaderText}>{t('admin.supplyDelete.loading')}</span>
            </div>
          )}

          {depsQuery.error && (
            <p style={errorBanner}>{t('admin.supplyDelete.failed')}</p>
          )}

          {deps && (
            <>
              {/* Metric grid */}
              <div style={metricGrid}>
                <Metric
                  label={t('admin.supplyDelete.metric.recipes')}
                  value={String(deps.recipe_count)}
                  highlighted={hasRecipes}
                />
                <Metric
                  label={t('admin.supplyDelete.metric.products')}
                  value={String(deps.product_count)}
                  highlighted={deps.product_count > 0}
                />
                <Metric
                  label={t('admin.supplyDelete.metric.modifiers')}
                  value={String(deps.modifier_count)}
                  highlighted={hasModifiers}
                />
                <Metric
                  label={t('admin.supplyDelete.metric.storagesWithStock')}
                  value={String(deps.storages_with_stock)}
                  highlighted={hasStock}
                />
                <Metric
                  label={t('admin.supplyDelete.metric.totalStock')}
                  value={deps.total_stock}
                />
                <Metric
                  label={t('admin.supplyDelete.metric.lastMovement')}
                  value={formatRelativeDate(
                    deps.last_movement_at,
                    t('admin.supplyDelete.never'),
                  )}
                />
              </div>

              {/* Warnings */}
              {anyWarning && (
                <ul style={warningList}>
                  {hasStock && (
                    <li style={warningItem}>
                      <span style={warningDot} aria-hidden="true" />
                      <span>
                        {interpolate(
                          t('admin.supplyDelete.warnings.hasStock'),
                          { count: deps.storages_with_stock },
                        )}
                      </span>
                    </li>
                  )}
                  {hasRecipes && (
                    <li style={warningItem}>
                      <span style={warningDot} aria-hidden="true" />
                      <span>
                        {interpolate(
                          t('admin.supplyDelete.warnings.hasRecipes'),
                          {
                            recipes: deps.recipe_count,
                            products: deps.product_count,
                          },
                        )}
                      </span>
                    </li>
                  )}
                  {hasModifiers && (
                    <li style={warningItem}>
                      <span style={warningDot} aria-hidden="true" />
                      <span>
                        {interpolate(
                          t('admin.supplyDelete.warnings.hasModifiers'),
                          { count: deps.modifier_count },
                        )}
                      </span>
                    </li>
                  )}
                </ul>
              )}

              {hasRecipes && (
                <p style={cascadeNote}>{t('admin.supplyDelete.cascadeHint')}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer style={footer}>
          <button
            type="button"
            style={btnGhost}
            onClick={onClose}
            disabled={deleteMut.isPending}
          >
            {t('admin.supplyDelete.cancel')}
          </button>
          {hasRecipes && (
            <button
              type="button"
              style={btnResolve}
              onClick={onResolveCascade}
              disabled={deleteMut.isPending || depsQuery.isLoading}
            >
              {t('admin.supplyDelete.resolveCascade')}
            </button>
          )}
          <button
            type="button"
            style={anyWarning ? btnDanger : btnPrimary}
            onClick={() => deleteMut.mutate()}
            disabled={deleteMut.isPending || depsQuery.isLoading}
          >
            {deleteMut.isPending ? (
              <>
                <Spinner size={14} />
                <span>
                  {anyWarning
                    ? t('admin.supplyDelete.confirm')
                    : t('admin.supplyDelete.confirmSafe')}
                </span>
              </>
            ) : (
              <span>
                {anyWarning
                  ? t('admin.supplyDelete.confirm')
                  : t('admin.supplyDelete.confirmSafe')}
              </span>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface MetricProps {
  label: string;
  value: string;
  highlighted?: boolean;
}
function Metric({ label, value, highlighted }: MetricProps) {
  return (
    <div style={highlighted ? metricCellHi : metricCell}>
      <span style={metricLabel}>{label}</span>
      <span style={highlighted ? metricValueHi : metricValue}>{value}</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 250,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const card: CSSProperties = {
  width: 'min(620px, 100%)',
  maxHeight: 'min(92vh, 700px)',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 18px 48px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.10)',
  overflow: 'hidden',
};

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '22px 26px 16px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const title: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
  lineHeight: 1.2,
};

const subtitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: '4px 0 0',
  fontWeight: 500,
};

const lead: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: '8px 0 0',
  lineHeight: 1.45,
};

const closeBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '18px 26px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const metricGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
};

const metricCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
};

const metricCellHi: CSSProperties = {
  ...metricCell,
  borderColor: 'rgba(201,164,92,0.45)',
  background: 'rgba(201,164,92,0.06)',
};

const metricLabel: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const metricValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.005em',
};

const metricValueHi: CSSProperties = {
  ...metricValue,
  color: 'var(--text1)',
};

const warningList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  borderRadius: 10,
  background: 'rgba(196,80,64,0.06)',
};

const warningItem: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  fontSize: 12,
  color: 'var(--text2)',
  lineHeight: 1.5,
};

const warningDot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'var(--red)',
  marginTop: 6,
  flexShrink: 0,
};

const cascadeNote: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  margin: 0,
  padding: '10px 12px',
  border: '1px dashed var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  fontStyle: 'italic',
};

const errorBanner: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
  margin: 0,
};

const loaderWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  padding: '24px 0',
};

const loaderText: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
};

const footer: CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '14px 26px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg2)',
  flexShrink: 0,
  justifyContent: 'flex-end',
};

const btnGhost: CSSProperties = {
  padding: '0 18px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const btnPrimary: CSSProperties = {
  padding: '0 22px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 150,
};

const btnDanger: CSSProperties = {
  padding: '0 22px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid var(--red)',
  background: 'var(--red)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 180,
};

// Resolve-cascade sits between Cancel and the destructive Deactivate as the
// preferred outcome when there are real recipe deps. Gold border / text to
// look like "take the considered path" rather than "the danger button".
const btnResolve: CSSProperties = {
  padding: '0 18px',
  height: 40,
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid rgba(201,164,92,0.55)',
  background: 'rgba(201,164,92,0.10)',
  color: '#7a5a1f',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
