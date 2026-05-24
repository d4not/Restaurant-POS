import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCurrentRegister,
  verifyProvisionalRegister,
  type CashRegisterRow,
} from '../api/registers';
import { ApiError } from '../api/client';
import { useSession } from '../store/session';
import { useTranslation } from '../i18n';
import { Spinner } from './Spinner';
import { formatMoney } from '../utils/format';

const CASHIER_ROLES: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

const styles: Record<string, React.CSSProperties> = {
  banner: {
    flexShrink: 0,
    padding: '10px 20px',
    background: 'rgba(201,164,92,0.16)',
    borderBottom: '1px solid rgba(201,164,92,0.4)',
    color: '#8a6d2a',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    fontSize: 13,
  },
  textBlock: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.35,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: '0.04em',
  },
  sub: {
    fontSize: 12,
    color: '#7a5c2a',
    opacity: 0.85,
  },
  verifyBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid rgba(44,36,32,0.12)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  scrim: {
    position: 'fixed', inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 70,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: 480, maxWidth: '94vw',
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  head: { padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' },
  modalTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 600, margin: 0,
  },
  modalSub: { fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.4 },
  body: { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  input: {
    height: 44,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 16,
    outline: 'none',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  },
  err: {
    padding: '10px 12px',
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.3)',
    color: 'var(--red)',
    borderRadius: 8,
    fontSize: 13,
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    columnGap: 16,
    rowGap: 10,
    fontSize: 14,
    color: 'var(--text2)',
  },
  resultsAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    fontSize: 16,
  },
  diffRow: {
    paddingTop: 12,
    marginTop: 4,
    borderTop: '1px solid var(--border)',
    fontWeight: 700,
    fontSize: 16,
  },
  diffAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  diffZero: { color: 'var(--green)' },
  diffPos: { color: 'var(--gold)' },
  diffNeg: { color: 'var(--red)' },
  actions: {
    padding: '14px 24px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 13, fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  primaryBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 14, fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
};

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

interface VerifyResult {
  reg: CashRegisterRow;
  submittedAmount: number;
}

// Sticky banner mounted by App below the topbar while the current shift is
// provisional. Floor staff see "waiting for cashier" copy; cashier+ get a
// "Verify shift" CTA that opens a blind-count modal. After verify, the
// banner unmounts (is_provisional=false) and the same shift continues.
export function ProvisionalShiftBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canVerify = CASHIER_ROLES.has(role);

  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    staleTime: 15_000,
  });

  const reg = registerQuery.data;
  const [modalOpen, setModalOpen] = useState(false);
  const [actualInput, setActualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verifyMutation = useMutation({
    mutationFn: ({ id, amountCentavos }: { id: string; amountCentavos: number }) =>
      verifyProvisionalRegister(id, { actual_amount: amountCentavos }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(['register', 'current'], updated);
      queryClient.invalidateQueries({ queryKey: ['register'] });
      setResult({ reg: updated, submittedAmount: variables.amountCentavos });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('provisional.couldNotVerify')),
  });

  if (!reg || !reg.is_provisional) return null;

  function openModal() {
    setActualInput('');
    setError(null);
    setResult(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setResult(null);
  }

  function submit() {
    if (!reg) return;
    setError(null);
    const amt = parseAmount(actualInput);
    if (amt == null) {
      setError(t('register.enterCounted'));
      return;
    }
    verifyMutation.mutate({ id: reg.id, amountCentavos: amt });
  }

  return (
    <>
      <div style={styles.banner}>
        <div style={styles.textBlock}>
          <span style={styles.title}>{t('provisional.banner')}</span>
          <span style={styles.sub}>
            {t('provisional.openedBy').replace('{name}', reg.user.name)} · {t('provisional.bannerSub')}
          </span>
        </div>
        {canVerify && (
          <button type="button" style={styles.verifyBtn} onClick={openModal}>
            {t('provisional.verifyBtn')}
          </button>
        )}
      </div>

      {modalOpen && (
        <div style={styles.scrim} onClick={closeModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog">
            {result ? (
              <VerifyResultsBody
                result={result}
                onDone={closeModal}
              />
            ) : (
              <>
                <div style={styles.head}>
                  <h2 style={styles.modalTitle}>{t('provisional.verifyTitle')}</h2>
                  <div style={styles.modalSub}>{t('provisional.verifySub')}</div>
                </div>
                <div style={styles.body}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={styles.fieldLabel}>
                      {t('register.blindCountPrompt')} (MXN)
                    </span>
                    <input
                      autoFocus
                      inputMode="decimal"
                      style={styles.input}
                      placeholder="0.00"
                      value={actualInput}
                      onChange={(e) => setActualInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          submit();
                        }
                      }}
                    />
                  </label>
                  {error && <div style={styles.err}>{error}</div>}
                </div>
                <div style={styles.actions}>
                  <button type="button" style={styles.cancelBtn} onClick={closeModal}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    style={styles.primaryBtn}
                    onClick={submit}
                    disabled={verifyMutation.isPending}
                  >
                    {verifyMutation.isPending && <Spinner size={12} />}
                    {t('provisional.verifyBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function VerifyResultsBody({
  result,
  onDone,
}: {
  result: VerifyResult;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const expectedRaw = result.reg.provisional_expected_amount ?? '0';
  const diffRaw = result.reg.provisional_difference ?? '0';
  const diffNum = Number(diffRaw);
  const diffSign: 'pos' | 'neg' | 'zero' =
    diffNum > 0 ? 'pos' : diffNum < 0 ? 'neg' : 'zero';
  const diffStyle =
    diffSign === 'zero'
      ? styles.diffZero
      : diffSign === 'pos'
        ? styles.diffPos
        : styles.diffNeg;
  const diffPrefix = diffNum > 0 ? '+' : '';

  return (
    <>
      <div style={styles.head}>
        <h2 style={styles.modalTitle}>{t('provisional.verifyResultsTitle')}</h2>
        <div style={styles.modalSub}>{t('provisional.verifyResultsSub')}</div>
      </div>
      <div style={styles.body}>
        <div style={styles.resultsGrid}>
          <span>{t('register.expected')}</span>
          <span style={styles.resultsAmt}>{formatMoney(expectedRaw)}</span>
          <span>{t('register.counted')}</span>
          <span style={styles.resultsAmt}>{formatMoney(result.submittedAmount)}</span>
        </div>
        <div style={{ ...styles.resultsGrid, ...styles.diffRow, ...diffStyle }}>
          <span>{t('register.difference')}</span>
          <span style={{ ...styles.diffAmt, color: 'inherit' }}>
            {diffNum === 0 ? formatMoney(0) : diffPrefix + formatMoney(diffRaw)}
          </span>
        </div>
      </div>
      <div style={styles.actions}>
        <button type="button" style={styles.primaryBtn} onClick={onDone}>
          {t('common.done')}
        </button>
      </div>
    </>
  );
}
