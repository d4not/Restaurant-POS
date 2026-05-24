import { useEffect, useState } from 'react';
import type { TipAllocation, TipPool } from '../../types/people';
import { amountToCentavos, formatMoney } from '../../utils/format';
import { useUpdateTipAllocation } from '../../hooks/useTips';
import { useTranslation } from '../../i18n';
import { EmployeeAvatar } from './EmployeeAvatar';

interface Props {
  pool: TipPool;
  onMutate?: () => void;
}

export function TipAllocationTable({ pool, onMutate }: Props) {
  const { t } = useTranslation();
  const updateM = useUpdateTipAllocation();
  const editable = pool.status === 'OPEN';

  const totalCollected = Number(pool.total_collected);
  const includedSum = pool.allocations
    .filter((a) => a.included)
    .reduce((sum, a) => sum + Number(a.final_amount), 0);
  const residue = totalCollected - includedSum;
  const includedCount = pool.allocations.filter((a) => a.included).length;

  return (
    <div className="table-wrap">
      <div
        className="table-head"
        style={{ gridTemplateColumns: '2fr 90px 110px 120px 140px 1fr', columnGap: 12 }}
      >
        <div>{t('common.name')}</div>
        <div>{t('people.tips.attended')}</div>
        <div>{t('people.tips.included')}</div>
        <div>{t('people.tips.baseAmount')}</div>
        <div>{t('people.tips.override')}</div>
        <div>{t('people.tips.finalAmount')}</div>
      </div>

      {pool.allocations.length === 0 && (
        <div
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--text3)',
            fontSize: 13,
          }}
        >
          {t('common.noResults')}
        </div>
      )}

      {pool.allocations.map((alloc, idx) => (
        <AllocationRow
          key={alloc.id}
          alloc={alloc}
          poolId={pool.id}
          editable={editable}
          odd={idx % 2 === 1}
          isPending={updateM.isPending}
          onMutate={onMutate}
        />
      ))}

      <div
        style={{
          padding: '12px 16px',
          background: 'var(--sidebar2)',
          color: '#f0e0c0',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          {t('people.tips.includedCount')}: <strong>{includedCount}</strong>
        </div>
        <div>
          {t('people.tips.totalCollected')}:{' '}
          <strong>{formatMoney(totalCollected)}</strong>
          {' · '}
          {t('people.tips.totalDistributed')}:{' '}
          <strong>{formatMoney(includedSum)}</strong>
          {' · '}
          {t('people.tips.residue')}:{' '}
          <strong style={{ color: residue !== 0 ? 'var(--gold)' : '#f0e0c0' }}>
            {formatMoney(residue)}
          </strong>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  alloc: TipAllocation;
  poolId: string;
  editable: boolean;
  odd: boolean;
  isPending: boolean;
  onMutate?: () => void;
}

function AllocationRow({
  alloc,
  poolId,
  editable,
  odd,
  isPending,
  onMutate,
}: RowProps) {
  const updateM = useUpdateTipAllocation();
  // Override is stored as cents string ("4500") or null; the input holds
  // a decimal string ("45.00") so the user can type currency values.
  const initialOverride =
    alloc.override_amount != null
      ? (Number(alloc.override_amount) / 100).toFixed(2)
      : '';
  const [overrideStr, setOverrideStr] = useState(initialOverride);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setOverrideStr(initialOverride);
    setLocalError(null);
  }, [initialOverride]);

  const commitOverride = async () => {
    if (!editable) return;
    const trimmed = overrideStr.trim();
    setLocalError(null);

    // Empty = clear override
    let value: number | null;
    if (trimmed === '') {
      value = null;
    } else {
      const cents = amountToCentavos(trimmed);
      if (cents === null) {
        setLocalError('Invalid amount');
        return;
      }
      value = cents;
    }

    // No-op if unchanged
    const current =
      alloc.override_amount != null ? Number(alloc.override_amount) : null;
    if (value === current) return;

    try {
      await updateM.mutateAsync({
        poolId,
        userId: alloc.user_id,
        input: { override_amount: value },
      });
      onMutate?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const toggleIncluded = async (next: boolean) => {
    if (!editable) return;
    try {
      await updateM.mutateAsync({
        poolId,
        userId: alloc.user_id,
        input: { included: next },
      });
      onMutate?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div
      className={`table-row ${odd ? 'odd' : 'even'}`}
      style={{
        gridTemplateColumns: '2fr 90px 110px 120px 140px 1fr',
        columnGap: 12,
        cursor: 'default',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <EmployeeAvatar
          name={alloc.user?.name ?? '—'}
          role={alloc.user?.role}
          size={30}
        />
        <div style={{ minWidth: 0 }}>
          <div className="fw-600 fs-13" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {alloc.user?.name ?? '—'}
          </div>
          <div className="fs-11 text-muted">
            {alloc.user?.position ?? alloc.user?.role ?? ''}
          </div>
        </div>
      </div>
      <div className="fs-12">
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            background: 'var(--gold-bg)',
            color: 'var(--gold)',
            borderRadius: 12,
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          {alloc.attended_days}d
        </span>
      </div>
      <div>
        <input
          type="checkbox"
          checked={alloc.included}
          disabled={!editable || isPending || updateM.isPending}
          onChange={(e) => toggleIncluded(e.target.checked)}
          style={{ width: 18, height: 18, cursor: editable ? 'pointer' : 'default' }}
        />
      </div>
      <div className="fs-13" style={{ color: 'var(--text2)' }}>
        {formatMoney(Number(alloc.base_amount))}
      </div>
      <div>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={overrideStr}
          onChange={(e) => setOverrideStr(e.target.value)}
          onBlur={commitOverride}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disabled={!editable}
          placeholder="—"
          style={{
            width: '100%',
            height: 32,
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 8px',
            fontSize: 13,
            background: editable ? 'var(--bg)' : 'transparent',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        />
        {localError && (
          <div className="fs-11" style={{ color: 'var(--red)', marginTop: 2 }}>
            {localError}
          </div>
        )}
      </div>
      <div
        className="fw-600 fs-14"
        style={{
          color: alloc.included ? 'var(--text)' : 'var(--text3)',
        }}
      >
        {formatMoney(Number(alloc.final_amount))}
      </div>
    </div>
  );
}
