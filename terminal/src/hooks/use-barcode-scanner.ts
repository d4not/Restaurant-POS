import { useCallback, useEffect, useRef } from 'react';

export interface BarcodeScannerOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
  // Drop buffers shorter than this — filters single accidental keypresses
  // (typing a number into a focused field shouldn't fire a "scan").
  minLength?: number;
  // Flush the buffer if no key arrives within this many ms. HID scanners burst
  // characters at sub-10ms intervals, so 50ms cleanly separates a paste/scan
  // from a slow human typing.
  gapMs?: number;
}

export interface BarcodeScannerHandle {
  ref: React.RefObject<HTMLInputElement | null>;
  reset: () => void;
}

/**
 * Listen for keystrokes on a focused input and emit a "scan" when the user
 * types fast enough to look like a HID barcode scanner (USB cheap unit). The
 * input element is mounted by the caller — this hook only attaches listeners
 * via the returned ref.
 *
 * Flush triggers (in priority order):
 *   1. Enter key            — most scanners append CR/LF as a suffix
 *   2. `gapMs` of inactivity — fallback for scanners configured without suffix
 *
 * The hook holds the buffer privately; it never mutates the input value, so
 * the caller can render a controlled input and clear it after `reset()`.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 4,
  gapMs = 50,
}: BarcodeScannerOptions): BarcodeScannerHandle {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bufferRef = useRef<string>('');
  const timerRef = useRef<number | null>(null);
  // Hold the latest options in refs so we don't have to re-attach the
  // listener every render. Re-attaching mid-scan would lose the buffer.
  const onScanRef = useRef(onScan);
  const minLenRef = useRef(minLength);
  onScanRef.current = onScan;
  minLenRef.current = minLength;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    const code = bufferRef.current;
    bufferRef.current = '';
    if (code.length >= minLenRef.current) {
      onScanRef.current(code);
    }
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    bufferRef.current = '';
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const el = inputRef.current;
    if (!el) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        flush();
        return;
      }
      // Single printable character only. Modifier keys (Shift, etc.) and
      // navigation keys (ArrowLeft, Home, etc.) emit longer `key` strings
      // that we can ignore.
      if (e.key.length !== 1) return;
      bufferRef.current += e.key;
      clearTimer();
      timerRef.current = window.setTimeout(flush, gapMs);
    }

    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
      clearTimer();
    };
  }, [enabled, flush, gapMs, clearTimer, reset]);

  return { ref: inputRef, reset };
}
