import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLowStock } from '../../hooks/useAlerts';
import type { LowStockAlert } from '../../api/alerts';
import { useAnchoredPos } from '../../hooks/useAnchoredPos';
import { useTranslation } from '../../i18n';

type Severity = 'out' | 'low';

interface RowWithSeverity extends LowStockAlert {
  severity: Severity;
}

function classify(alert: LowStockAlert): Severity {
  return Number.parseFloat(alert.quantity) <= 0 ? 'out' : 'low';
}

export function StockBellButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const pos = useAnchoredPos(open, triggerRef);
  const { data, isLoading } = useLowStock();

  const rows = useMemo<RowWithSeverity[]>(() => {
    const items = data?.items ?? [];
    return items
      .map((a) => ({ ...a, severity: classify(a) }))
      // OUT before LOW; within each, biggest shortfall first
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'out' ? -1 : 1;
        return Number.parseFloat(b.shortfall) - Number.parseFloat(a.shortfall);
      });
  }, [data]);

  const outCount = rows.filter((r) => r.severity === 'out').length;
  const lowCount = rows.length - outCount;
  const hasOut = outCount > 0;
  const total = rows.length;

  // Click-outside to close. Trigger is excluded so the toggle button stays
  // functional even when the panel is open.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Badge color: red when ANY supply is out, gold when only low.
  const badgeColor = hasOut ? 'var(--red)' : 'var(--gold)';
  const showBadge = total > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="notif-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('stock.bell.title')}
        title={t('stock.bell.title')}
        style={{ position: 'relative' }}
      >
        <span aria-hidden="true">🔔</span>
        {showBadge && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              background: badgeColor,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              border: '2px solid var(--bg)',
              boxSizing: 'content-box',
            }}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('stock.bell.title')}
          style={{
            position: 'fixed',
            top: pos.top,
            right: pos.right,
            width: 360,
            maxHeight: 'calc(100vh - 100px)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 500,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 15,
                fontWeight: 600,
                margin: 0,
              }}
            >
              {t('stock.bell.title')}
            </h2>
            {total > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                {outCount > 0 && `${outCount} ${t('stock.severity.out')}`}
                {outCount > 0 && lowCount > 0 && ' · '}
                {lowCount > 0 && `${lowCount} ${t('stock.severity.low')}`}
              </span>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {isLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {t('common.loading')}…
              </div>
            ) : total === 0 ? (
              <div style={{ padding: '36px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {t('stock.bell.empty')}
                </div>
              </div>
            ) : (
              <>
                {outCount > 0 && (
                  <SectionHeader
                    label={`${t('stock.bell.outSection')} (${outCount})`}
                    color="var(--red)"
                  />
                )}
                {rows.filter((r) => r.severity === 'out').map((r) => (
                  <AlertRow
                    key={`${r.supply_id}|${r.storage_id}`}
                    row={r}
                    onClick={() => {
                      setOpen(false);
                      navigate(`/inventory/supplies/${r.supply_id}`);
                    }}
                  />
                ))}
                {lowCount > 0 && (
                  <SectionHeader
                    label={`${t('stock.bell.lowSection')} (${lowCount})`}
                    color="var(--gold)"
                  />
                )}
                {rows.filter((r) => r.severity === 'low').map((r) => (
                  <AlertRow
                    key={`${r.supply_id}|${r.storage_id}`}
                    row={r}
                    onClick={() => {
                      setOpen(false);
                      navigate(`/inventory/supplies/${r.supply_id}`);
                    }}
                  />
                ))}
              </>
            )}
          </div>

          {total > 0 && (
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--border)',
                textAlign: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/inventory/supplies');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--blue)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('stock.bell.viewAll')} →
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        padding: '10px 16px 6px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color,
        background: '#ede8df',
      }}
    >
      {label}
    </div>
  );
}

function AlertRow({ row, onClick }: { row: RowWithSeverity; onClick: () => void }) {
  const qty = Number.parseFloat(row.quantity);
  const min = Number.parseFloat(row.min_stock);
  const ratio = min > 0 ? Math.max(0, Math.min(1, qty / min)) : 0;
  const fillColor = row.severity === 'out' ? 'var(--red)' : 'var(--gold)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '10px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#fef8ef')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>
          {row.supply_name}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: fillColor,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {qty} / {min}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
        {row.storage_name}
      </div>
      <div
        style={{
          height: 4,
          background: 'var(--border)',
          borderRadius: 2,
          overflow: 'hidden',
          marginTop: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${ratio * 100}%`,
            background: fillColor,
            transition: 'width 0.2s',
          }}
        />
      </div>
    </button>
  );
}
