import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOpenRegister } from '../../api/registers';
import { useSession } from '../../store/session';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';
import { OperationsHubCard } from './OperationsHubCard';
import {
  IconArrowDown,
  IconArrowUp,
  IconChart,
  IconRegister,
  IconTransfer,
} from './HubIcons';
import { IconPrinter } from '../Icons';
import { ShiftActionPanel } from './ShiftActionPanel';
import { CashMovementModal } from './CashMovementModal';
import { DailyReportModal } from './DailyReportModal';
import { TransferModal } from './TransferModal';
import { PrinterCheckPanel } from './PrinterCheckPanel';
import { formatTime } from '../../utils/clock';

interface OperationsHubModalProps {
  open: boolean;
  onClose: () => void;
}

type SubFlow =
  | null
  | 'shift'
  | 'expense'
  | 'income'
  | 'dailyReport'
  | 'transfer'
  | 'printerCheck';

export function OperationsHubModal({ open, onClose }: OperationsHubModalProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const [subFlow, setSubFlow] = useState<SubFlow>(null);

  // Reset the open child whenever the hub closes — opening it again should
  // start at the grid view, not whichever sub-flow was last in front.
  useEffect(() => {
    if (!open) setSubFlow(null);
  }, [open]);

  // Same query the topbar uses, identical key — no extra fetch when both are
  // mounted. Drives the disabled-state hint on income/expense (we can't post a
  // CashMovement without an open register).
  const registerQuery = useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => fetchOpenRegister(userId!),
    enabled: open && Boolean(userId),
    staleTime: 30_000,
  });
  const reg = registerQuery.data;
  const hasOpenShift = Boolean(reg);

  // ESC closes the hub itself, only when no sub-flow is in front. Each sub-flow
  // attaches its own ESC handler that stops propagation, so the hub's listener
  // doesn't fire while a child is open.
  useEffect(() => {
    if (!open || subFlow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, subFlow, onClose]);

  if (!open) return null;

  const shiftHint = hasOpenShift && reg
    ? t('hub.action.shiftHintOpen').replace('{time}', formatTime(new Date(reg.opened_at)))
    : t('hub.action.shiftHintClosed');

  return (
    <>
      <div style={hubStyles.scrim} onClick={onClose}>
        <div style={hubStyles.hubModal} onClick={(e) => e.stopPropagation()} role="dialog">
          <div style={hubStyles.head}>
            <h2 style={hubStyles.title}>{t('hub.title')}</h2>
            <div style={hubStyles.sub}>{t('hub.subtitle')}</div>
          </div>

          <div style={hubStyles.hubGrid}>
            <OperationsHubCard
              Icon={IconRegister}
              title={t('hub.action.shift')}
              hint={shiftHint}
              accent={hasOpenShift ? 'green' : 'gold'}
              onClick={() => setSubFlow('shift')}
            />
            <OperationsHubCard
              Icon={IconArrowDown}
              title={t('hub.action.expense')}
              hint={t('hub.action.expenseHint')}
              accent="red"
              disabled={!hasOpenShift}
              disabledTitle={t('hub.disabled.noShift')}
              onClick={() => setSubFlow('expense')}
            />
            <OperationsHubCard
              Icon={IconArrowUp}
              title={t('hub.action.income')}
              hint={t('hub.action.incomeHint')}
              accent="green"
              disabled={!hasOpenShift}
              disabledTitle={t('hub.disabled.noShift')}
              onClick={() => setSubFlow('income')}
            />
            <OperationsHubCard
              Icon={IconChart}
              title={t('hub.action.dailyReport')}
              hint={t('hub.action.dailyReportHint')}
              accent="gold"
              onClick={() => setSubFlow('dailyReport')}
            />
            <OperationsHubCard
              Icon={IconTransfer}
              title={t('hub.action.transfer')}
              hint={t('hub.action.transferHint')}
              accent="gold"
              onClick={() => setSubFlow('transfer')}
            />
            <OperationsHubCard
              Icon={IconPrinter}
              title={t('hub.action.printerCheck')}
              hint={t('hub.action.printerCheckHint')}
              accent="neutral"
              onClick={() => setSubFlow('printerCheck')}
            />
          </div>
        </div>
      </div>

      <ShiftActionPanel open={subFlow === 'shift'} onClose={() => setSubFlow(null)} />
      <CashMovementModal
        open={subFlow === 'expense' || subFlow === 'income'}
        kind={subFlow === 'expense' ? 'CASH_OUT' : 'CASH_IN'}
        registerId={reg?.id ?? null}
        onClose={() => setSubFlow(null)}
      />
      <DailyReportModal
        open={subFlow === 'dailyReport'}
        currentRegisterId={reg?.id ?? null}
        onClose={() => setSubFlow(null)}
      />
      <TransferModal open={subFlow === 'transfer'} onClose={() => setSubFlow(null)} />
      <PrinterCheckPanel open={subFlow === 'printerCheck'} onClose={() => setSubFlow(null)} />
    </>
  );
}
