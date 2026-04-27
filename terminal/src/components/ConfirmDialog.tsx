import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useTranslation } from '../i18n';

// Imperative confirm dialog. Replaces window.confirm so destructive prompts
// (cancel order, remove sent item, sign out, etc.) match the warm theme and
// support keyboard shortcuts: Enter = confirm, Escape = dismiss.
//
// Usage anywhere — no provider required:
//
//   if (await confirmDialog({
//     title: 'Cancel order?',
//     message: 'This cannot be undone.',
//     confirmLabel: 'Cancel order',
//     danger: true,
//   })) { ... }

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  resolveWith: (ok: boolean) => void;
}

const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // If a previous dialog is still pending (shouldn't happen in practice
      // because the host renders modally), resolve it as cancelled so we don't
      // leak the promise.
      const prev = get().resolve;
      if (prev) prev(false);
      set({ open: true, options, resolve });
    }),
  resolveWith: (ok) => {
    const { resolve } = get();
    if (resolve) resolve(ok);
    set({ open: false, options: null, resolve: null });
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirm.getState().ask(options);
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 440,
    maxWidth: '100%',
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  body: {
    padding: '24px 26px 22px',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  message: {
    fontSize: 14,
    color: 'var(--text2)',
    marginTop: 10,
    lineHeight: 1.5,
  },
  actions: {
    padding: '14px 22px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    background: 'var(--bg)',
  },
  cancelBtn: {
    padding: '11px 18px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 42,
    minWidth: 92,
  },
  confirmBtn: {
    padding: '11px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 42,
    minWidth: 92,
  },
  dangerBtn: {
    padding: '11px 18px',
    borderRadius: 8,
    background: 'var(--red)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--red)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 42,
    minWidth: 92,
  },
};

export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const open = useConfirm((s) => s.open);
  const options = useConfirm((s) => s.options);
  const resolveWith = useConfirm((s) => s.resolveWith);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus the confirm button so a keyboard user (or stray Enter on a
  // touch-keyboard) can act without an extra Tab. Re-focused each time a new
  // dialog opens.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => confirmRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Global keyboard shortcuts: Escape dismisses, Enter confirms. We listen on
  // the window so the focus target doesn't matter.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveWith(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolveWith(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, resolveWith]);

  if (!open || !options) return null;

  const confirmStyle = options.danger ? styles.dangerBtn : styles.confirmBtn;

  return (
    <div style={styles.scrim} onClick={() => resolveWith(false)}>
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={styles.body}>
          <h2 style={styles.title}>{options.title}</h2>
          {options.message && <div style={styles.message}>{options.message}</div>}
        </div>
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.cancelBtn}
            onClick={() => resolveWith(false)}
          >
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            style={confirmStyle}
            onClick={() => resolveWith(true)}
          >
            {options.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
