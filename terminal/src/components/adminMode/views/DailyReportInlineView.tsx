// Inline Z-report viewer. Sits inside ShiftAuditView via local state — the
// "View report" button on a day group swaps this in for the audit table.
// We render the printable HTML the backend already serves (the same one the
// admin web app uses) inside an iframe via `srcDoc`. That keeps the report's
// embedded CSS — toolbar, @media print, fonts — isolated from the terminal's
// styles while still letting us drive `window.print()` from a button up here.

import { useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminViewShell } from './AdminViewShell';
import { Spinner } from '../../Spinner';
import {
  fetchDailyReportPrintHtml,
  type DailyReportSummary,
} from '../../../api/daily-reports';
import { ApiError } from '../../../api/client';
import { useTranslation } from '../../../i18n';

interface DailyReportInlineViewProps {
  report: DailyReportSummary;
  onBack: () => void;
}

function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

export function DailyReportInlineView({
  report,
  onBack,
}: DailyReportInlineViewProps) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const htmlQuery = useQuery({
    queryKey: ['daily-report', report.id, 'print-html'],
    queryFn: () => fetchDailyReportPrintHtml(report.id),
    // Print HTML is stable for the same report (close-time snapshot). One
    // fetch per view is enough.
    staleTime: Infinity,
  });

  function handlePrint() {
    setPrintError(null);
    const win = iframeRef.current?.contentWindow;
    if (!win) {
      setPrintError(t('admin.shiftAudit.zReport.viewFailed'));
      return;
    }
    try {
      win.focus();
      win.print();
    } catch {
      setPrintError(t('admin.shiftAudit.zReport.viewFailed'));
    }
  }

  const errorMessage = htmlQuery.error
    ? htmlQuery.error instanceof ApiError
      ? htmlQuery.error.message
      : t('admin.shiftAudit.zReport.viewFailed')
    : null;

  return (
    <AdminViewShell
      titleKey="admin.shiftAudit.zReport.windowTitle"
      onBack={onBack}
      headerActions={
        <>
          <span style={folioChip}>{folioLabel(report.folio)}</span>
          <button
            type="button"
            style={printBtn}
            onClick={handlePrint}
            disabled={!htmlQuery.data}
          >
            {t('admin.shiftAudit.zReport.print')}
          </button>
        </>
      }
    >
      {htmlQuery.isLoading ? (
        <div style={loadingWrap}>
          <Spinner />
        </div>
      ) : errorMessage ? (
        <div style={errorWrap} role="alert">
          {errorMessage}
          <button
            type="button"
            style={retryBtn}
            onClick={() => htmlQuery.refetch()}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          {printError && (
            <div style={errorBanner} role="alert">
              {printError}
            </div>
          )}
          <iframe
            ref={iframeRef}
            srcDoc={htmlQuery.data ?? ''}
            title={t('admin.shiftAudit.zReport.windowTitle')}
            style={iframeStyle}
            // Same-origin srcDoc — keep it sandbox-free so window.print() and
            // the embedded toolbar's window.print() button both work.
          />
        </>
      )}
    </AdminViewShell>
  );
}

const folioChip: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.14em',
  padding: '6px 12px',
  borderRadius: 999,
  background: 'rgba(74,140,92,0.16)',
  color: '#3a6a48',
  fontVariantNumeric: 'tabular-nums',
  textTransform: 'uppercase',
  alignSelf: 'center',
};

const printBtn: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: 'var(--surface)',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
};

const loadingWrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 64,
};

const errorWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 64,
  color: 'var(--red)',
  fontSize: 14,
};

const retryBtn: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const errorBanner: CSSProperties = {
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.4)',
  color: 'var(--red)',
  padding: '10px 14px',
  fontSize: 13,
  borderRadius: 6,
  marginBottom: 12,
};

// Full-bleed iframe — the report's own CSS handles paper margins and print
// styling. We pin to 100% width + a tall height so the whole report scrolls
// in one piece; the surrounding AdminViewShell already owns the outer scroll
// when the body overflows.
const iframeStyle: CSSProperties = {
  width: '100%',
  height: 'calc(100vh - 180px)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#fff',
};
