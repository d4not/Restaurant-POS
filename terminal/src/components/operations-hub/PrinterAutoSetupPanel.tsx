// Auto-setup panel for the Electron printers (USB + OS spooler).
//
// This panel pairs the IPC bridge resolver with a one-click UI. For each role
// (kitchen / receipt) we show:
//   • the current saved config
//   • the resolver's recommendation, with a colour-coded badge
//   • the suggested primary candidate (and a way to apply it)
//   • a collapsible list of ranked alternatives for one-click swap
//
// Strings are English-hardcoded for now — i18n is being heavily edited in a
// parallel agent's branch, so the keys land later as part of the merge.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hubStyles } from './styles';
import { Spinner } from '../Spinner';
import { IconRefresh } from './HubIcons';

interface PrinterAutoSetupPanelProps {
  open: boolean;
  onClose: () => void;
}

const ROLES: PrinterRole[] = ['receipt', 'kitchen'];
const ROLE_LABEL: Record<PrinterRole, string> = {
  receipt: 'Receipt printer',
  kitchen: 'Kitchen printer',
};

// Colour + label per recommendation. Drives the badge next to each role title
// and the colour of the apply button.
const RECOMMENDATION_PRESETS: Record<PrinterRecommendation, { label: string; color: string; bg: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  'use-current': { label: 'Ready', color: 'var(--green)', bg: 'rgba(74,140,92,0.12)', tone: 'ok' },
  'investigate-current': { label: 'Action needed', color: 'var(--red)', bg: 'rgba(196,80,64,0.10)', tone: 'bad' },
  'switch-primary': { label: 'Switch recommended', color: 'var(--gold)', bg: 'rgba(201,164,92,0.15)', tone: 'warn' },
  'pick-primary': { label: 'Setup available', color: 'var(--gold)', bg: 'rgba(201,164,92,0.15)', tone: 'warn' },
  'permission-issue': { label: 'Blocked', color: 'var(--red)', bg: 'rgba(196,80,64,0.10)', tone: 'bad' },
  'no-printer-available': { label: 'None detected', color: 'var(--text3)', bg: 'rgba(168,152,136,0.12)', tone: 'info' },
};

const STATUS_LABEL: Record<DetectedPrinterStatus, string> = {
  ready: 'Ready',
  busy: 'Busy',
  stopped: 'Stopped',
  attention: 'Attention',
  permission_denied: 'Permission denied',
  unknown: 'Unknown',
};
const STATUS_COLOR: Record<DetectedPrinterStatus, string> = {
  ready: 'var(--green)',
  busy: 'var(--gold)',
  stopped: 'var(--red)',
  attention: 'var(--gold)',
  permission_denied: 'var(--red)',
  unknown: 'var(--text3)',
};

const styles: Record<string, React.CSSProperties> = {
  roleCard: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  roleHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  roleTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    flex: 1,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '3px 9px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  savedRow: {
    fontSize: 12,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    marginBottom: 6,
  },
  reasoning: {
    fontSize: 12,
    color: 'var(--text2)',
    lineHeight: 1.5,
    marginBottom: 10,
    background: 'var(--bg2)',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
  },
  candidateBlock: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  candidateLabel: {
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginBottom: 4,
  },
  candidateName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  candidateMeta: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
    fontVariantNumeric: 'tabular-nums',
  },
  candidateActions: {
    display: 'flex',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  altsToggle: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text2)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '8px 0 4px',
    fontFamily: 'inherit',
  },
  altRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    borderTop: '1px dashed var(--border)',
  },
  altInfo: { flex: 1, minWidth: 0 },
  applyBtn: {
    padding: '8px 14px',
    borderRadius: 7,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid rgba(44,36,32,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  applyBtnGhost: {
    padding: '6px 11px',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 32,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  testBtn: {
    padding: '6px 11px',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 32,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  toastOk: {
    padding: '8px 12px',
    borderRadius: 8,
    background: 'rgba(74,140,92,0.12)',
    border: '1px solid rgba(74,140,92,0.4)',
    color: 'var(--green)',
    fontSize: 12,
    marginTop: 10,
  },
  toastErr: {
    padding: '8px 12px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.45)',
    color: 'var(--red)',
    fontSize: 12,
    marginTop: 10,
  },
  unavailable: {
    padding: '24px 12px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    lineHeight: 1.5,
  },
  refreshBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
};

function CandidateBadge({ candidate }: { candidate: DetectedPrinter }) {
  return (
    <>
      <span style={{ ...styles.statusDot, background: STATUS_COLOR[candidate.status] }} />
      <span>{candidate.label}</span>
      {candidate.isUsb && <span style={{ fontSize: 10, color: 'var(--text3)' }}>USB</span>}
      {candidate.isDefault && <span style={{ fontSize: 10, color: 'var(--gold)' }}>DEFAULT</span>}
    </>
  );
}

export function PrinterAutoSetupPanel({ open, onClose }: PrinterAutoSetupPanelProps) {
  const queryClient = useQueryClient();
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron?.printer?.resolve);
  const [showAlts, setShowAlts] = useState<Record<PrinterRole, boolean>>({ receipt: false, kitchen: false });
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const planQuery = useQuery({
    queryKey: ['printer-resolve'],
    queryFn: async () => {
      if (!isElectron) throw new Error('Auto-setup is only available in the desktop terminal.');
      const result = await window.electron!.printer.resolve();
      return result;
    },
    enabled: open && isElectron,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const applyMutation = useMutation({
    mutationFn: async ({ role, candidate }: { role: PrinterRole; candidate: DetectedPrinter }) => {
      if (!isElectron) throw new Error('Apply requires the desktop terminal.');
      const res = await window.electron!.printer.applyCandidate({ role, candidate });
      if (!res.ok) throw new Error(res.error ?? 'apply_failed');
      return res;
    },
    onSuccess: async (_data, vars) => {
      setFeedback({ kind: 'ok', text: `Applied "${vars.candidate.label}" as ${ROLE_LABEL[vars.role].toLowerCase()}.` });
      await queryClient.invalidateQueries({ queryKey: ['printer-resolve'] });
      await queryClient.invalidateQueries({ queryKey: ['printer-diagnose'] });
      await queryClient.invalidateQueries({ queryKey: ['printer-status', 'hub'] });
    },
    onError: (err) =>
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save the printer config.' }),
  });

  const testMutation = useMutation({
    mutationFn: async (role: PrinterRole) => {
      if (!isElectron) throw new Error('Test print requires the desktop terminal.');
      const res = await window.electron!.printer.testPrint(role);
      if (!res.ok) throw new Error(res.error ?? 'test_failed');
      // Record the successful print so future resolves give this address sticky priority.
      const cfg = await window.electron!.printer.getConfig();
      const addr = cfg[role]?.address;
      if (addr) await window.electron!.printer.markWorking({ role, address: addr });
      return res;
    },
    onSuccess: (_data, role) => setFeedback({ kind: 'ok', text: `Test print sent to the ${ROLE_LABEL[role].toLowerCase()}.` }),
    onError: (err) => setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Test print failed.' }),
  });

  useEffect(() => {
    if (!open) {
      setFeedback(null);
      setShowAlts({ receipt: false, kitchen: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.wideChildModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>Auto-detect & configure</h2>
          <div style={hubStyles.sub}>
            One-click setup for kitchen + receipt printers. Picks the best USB / OS printer for each role.
          </div>
        </div>

        <div style={hubStyles.body}>
          {!isElectron ? (
            <div style={styles.unavailable}>
              Auto-setup only runs in the desktop terminal app.
              <br />
              Web sessions use the network printer configured in admin settings.
            </div>
          ) : planQuery.isLoading && !planQuery.data ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> Detecting printers…
            </div>
          ) : planQuery.isError ? (
            <div style={styles.toastErr}>
              Could not detect printers. {(planQuery.error as Error)?.message ?? ''}
            </div>
          ) : planQuery.data ? (
            <>
              {ROLES.map((role) => (
                <RoleBlock
                  key={role}
                  role={role}
                  data={planQuery.data[role]}
                  showAlternatives={showAlts[role]}
                  onToggleAlts={() => setShowAlts((prev) => ({ ...prev, [role]: !prev[role] }))}
                  onApply={(candidate) => applyMutation.mutate({ role, candidate })}
                  onTest={() => testMutation.mutate(role)}
                  applyingId={
                    applyMutation.isPending && applyMutation.variables?.role === role
                      ? applyMutation.variables.candidate.id
                      : null
                  }
                  testing={testMutation.isPending && testMutation.variables === role}
                />
              ))}

              {planQuery.data.counts.usb === 0 && planQuery.data.counts.system === 0 && (
                <div style={styles.toastErr}>
                  No printers detected. Plug a USB printer in or install its driver in the OS, then refresh.
                </div>
              )}

              {feedback && (
                <div style={feedback.kind === 'ok' ? styles.toastOk : styles.toastErr}>
                  {feedback.text}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div style={hubStyles.actions}>
          <button
            type="button"
            style={styles.refreshBtn}
            onClick={() => planQuery.refetch()}
            disabled={planQuery.isFetching}
          >
            {planQuery.isFetching ? <Spinner size={12} /> : <IconRefresh />}
            <span>Refresh</span>
          </button>
          <button type="button" style={hubStyles.primaryBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface RoleBlockProps {
  role: PrinterRole;
  data: PrinterResolveRoleResult;
  showAlternatives: boolean;
  onToggleAlts: () => void;
  onApply: (candidate: DetectedPrinter) => void;
  onTest: () => void;
  applyingId: string | null;
  testing: boolean;
}

function RoleBlock({
  role,
  data,
  showAlternatives,
  onToggleAlts,
  onApply,
  onTest,
  applyingId,
  testing,
}: RoleBlockProps) {
  const preset = RECOMMENDATION_PRESETS[data.plan.recommendation];
  const { plan, currentConfig } = data;
  const savedSummary = currentConfig.address
    ? `${currentConfig.connection.toUpperCase()} — ${currentConfig.address}`
    : 'Not configured';

  return (
    <div style={styles.roleCard}>
      <div style={styles.roleHead}>
        <div style={styles.roleTitle}>{ROLE_LABEL[role]}</div>
        <span style={{ ...styles.badge, color: preset.color, background: preset.bg, border: `1px solid ${preset.color}` }}>
          {preset.label}
        </span>
      </div>

      <div style={styles.savedRow}>Saved: {savedSummary}</div>

      <div style={styles.reasoning}>{plan.reasoning}</div>

      {plan.primary && (
        <div style={styles.candidateBlock}>
          <div style={styles.candidateLabel}>
            {plan.recommendation === 'use-current' ? 'Currently active' : 'Suggested'}
          </div>
          <div style={styles.candidateName}>
            <CandidateBadge candidate={plan.primary} />
          </div>
          <div style={styles.candidateMeta}>
            {STATUS_LABEL[plan.primary.status]}
            {plan.primary.port ? ` · ${plan.primary.port}` : ''}
            {' · '}
            {plan.primary.address}
          </div>
          {plan.primary.note && (
            <div style={{ ...styles.candidateMeta, color: 'var(--red)' }}>{plan.primary.note}</div>
          )}
          <div style={styles.candidateActions}>
            {plan.recommendation !== 'use-current' && (
              <button
                type="button"
                style={styles.applyBtn}
                onClick={() => onApply(plan.primary!)}
                disabled={Boolean(applyingId)}
              >
                {applyingId === plan.primary.id && <Spinner size={12} />}
                Apply this printer
              </button>
            )}
            {currentConfig.address && (
              <button
                type="button"
                style={styles.testBtn}
                onClick={onTest}
                disabled={testing}
              >
                {testing && <Spinner size={10} />}
                Test print
              </button>
            )}
          </div>
        </div>
      )}

      {plan.alternatives.length > 0 && (
        <>
          <button type="button" style={styles.altsToggle} onClick={onToggleAlts}>
            {showAlternatives ? '▾ Hide' : '▸ Show'} {plan.alternatives.length} other option{plan.alternatives.length === 1 ? '' : 's'}
          </button>
          {showAlternatives && (
            <div>
              {plan.alternatives.map((alt) => (
                <div key={alt.id} style={styles.altRow}>
                  <div style={styles.altInfo}>
                    <div style={styles.candidateName}>
                      <CandidateBadge candidate={alt} />
                    </div>
                    <div style={styles.candidateMeta}>
                      {STATUS_LABEL[alt.status]}
                      {alt.port ? ` · ${alt.port}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={styles.applyBtnGhost}
                    onClick={() => onApply(alt)}
                    disabled={Boolean(applyingId)}
                  >
                    {applyingId === alt.id && <Spinner size={10} />}
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
