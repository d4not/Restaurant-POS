import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentRegister } from '../../api/registers';
import { useSession } from '../../store/session';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';
import { OperationsHubCard } from './OperationsHubCard';
import {
  IconArrowDown,
  IconArrowUp,
  IconRegister,
  IconTransfer,
  IconWaste,
} from './HubIcons';
import { IconPrinter } from '../Icons';
import { ShiftActionPanel } from './ShiftActionPanel';
import { CashMovementModal } from './CashMovementModal';
// Daily Report intentionally not surfaced in the POS operations hub — it
// lives only in Admin Mode (Reports section) so cashiers focus on shift /
// cash / supply actions here.
import { TransferModal } from './TransferModal';
import { ErrandModal } from './ErrandModal';
import { PrinterCheckPanel } from './PrinterCheckPanel';
import { PrinterAutoSetupPanel } from './PrinterAutoSetupPanel';
import { formatTime } from '../../utils/clock';
import { useUi } from '../../store/ui';

interface OperationsHubModalProps {
  open: boolean;
  onClose: () => void;
}

type SubFlow =
  | null
  | 'shift'
  | 'expense'
  | 'income'
  | 'transfer'
  | 'errand'
  | 'printerCheck'
  | 'printerAuto';

// Cash + reporting actions are limited to roles that handle money. Floor
// staff (waiter/barista) still see transfer + printer check.
const CASHIER_ROLES: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

export function OperationsHubModal({ open, onClose }: OperationsHubModalProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const isCashier = CASHIER_ROLES.has(role);
  const [subFlow, setSubFlow] = useState<SubFlow>(null);
  const openWaste = useUi((s) => s.openWaste);

  // Reset the open child whenever the hub closes — opening it again should
  // start at the grid view, not whichever sub-flow was last in front.
  useEffect(() => {
    if (!open) setSubFlow(null);
  }, [open]);

  // Same singleton-shift lookup as App.tsx / topbar. Drives the disabled-state
  // hint on income/expense (we can't post a CashMovement without an open
  // register, and the singleton lookup is what tells us which one to attach
  // the movement to).
  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: open && Boolean(userId),
    staleTime: 15_000,
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
            {isCashier && (
              <OperationsHubCard
                Icon={IconRegister}
                title={t('hub.action.shift')}
                hint={shiftHint}
                accent={hasOpenShift ? 'green' : 'gold'}
                onClick={() => setSubFlow('shift')}
              />
            )}
            {isCashier && (
              <OperationsHubCard
                Icon={IconArrowDown}
                title={t('hub.action.expense')}
                hint={t('hub.action.expenseHint')}
                accent="red"
                disabled={!hasOpenShift}
                disabledTitle={t('hub.disabled.noShift')}
                onClick={() => setSubFlow('expense')}
              />
            )}
            {isCashier && (
              <OperationsHubCard
                Icon={IconArrowUp}
                title={t('hub.action.income')}
                hint={t('hub.action.incomeHint')}
                accent="green"
                disabled={!hasOpenShift}
                disabledTitle={t('hub.disabled.noShift')}
                onClick={() => setSubFlow('income')}
              />
            )}
            <OperationsHubCard
              Icon={IconTransfer}
              title={t('hub.action.transfer')}
              hint={t('hub.action.transferHint')}
              accent="gold"
              onClick={() => setSubFlow('transfer')}
            />
            {isCashier && (
              <OperationsHubCard
                Icon={IconArrowDown}
                title={t('hub.action.errand')}
                hint={t('hub.action.errandHint')}
                accent="gold"
                disabled={!hasOpenShift}
                disabledTitle={t('hub.disabled.noShift')}
                onClick={() => setSubFlow('errand')}
              />
            )}
            <OperationsHubCard
              Icon={IconWaste}
              title={t('hub.action.waste')}
              hint={t('hub.action.wasteHint')}
              accent="red"
              onClick={() => {
                // Full-screen waste workspace — close the hub on the way out so
                // the user lands on a clean surface.
                onClose();
                openWaste();
              }}
            />
            <OperationsHubCard
              Icon={IconPrinter}
              title={t('hub.action.printerCheck')}
              hint={t('hub.action.printerCheckHint')}
              accent="neutral"
              onClick={() => setSubFlow('printerCheck')}
            />
            {/* Desktop-only auto-setup. The card stays mounted in non-Electron
                contexts so cashiers see it during demos — the panel itself
                renders an "only in desktop terminal" hint when window.electron
                isn't around. */}
            <OperationsHubCard
              Icon={IconPrinter}
              title="Auto-detect printer"
              hint="One-click USB / OS printer setup"
              accent="gold"
              onClick={() => setSubFlow('printerAuto')}
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
      <TransferModal open={subFlow === 'transfer'} onClose={() => setSubFlow(null)} />
      <ErrandModal
        open={subFlow === 'errand'}
        registerId={reg?.id ?? null}
        onClose={() => setSubFlow(null)}
      />
      <PrinterCheckPanel open={subFlow === 'printerCheck'} onClose={() => setSubFlow(null)} />
      <PrinterAutoSetupPanel open={subFlow === 'printerAuto'} onClose={() => setSubFlow(null)} />
    </>
  );
}
