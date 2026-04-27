/**
 * Thin wrapper around node-thermal-printer that turns "send these lines to
 * this TCP printer" into a Promise that NEVER throws — every error is folded
 * into the returned `{ ok: false, error }` so callers can render a friendly
 * banner instead of the request 500ing. Connection refused, timeouts, missing
 * IP — all surface the same way.
 *
 * The library opens a fresh TCP socket per `execute()` call, so there's no
 * persistent connection state to manage here. Settings can be edited at any
 * time and the next print picks them up.
 */
import { ThermalPrinter, PrinterTypes } from 'node-thermal-printer';
import net from 'node:net';
import { logger } from '../../lib/logger.js';

export interface PrintResult {
  ok: boolean;
  error?: string;
}

export interface PrinterTarget {
  ip: string;
  port: number;
  width: number;
}

const TCP_TIMEOUT_MS = 3000;

// 80mm receipts fit 48 characters per line on most ESC/POS printers; 58mm fit
// 32. The library's built-in widths are character counts, not millimetres.
export function paperWidthChars(paperMm: number): number {
  if (paperMm === 58) return 32;
  return 48;
}

function makeInterface(target: PrinterTarget): string {
  return `tcp://${target.ip}:${target.port}`;
}

/**
 * Probe a TCP connection without sending any printer commands. Used by
 * `GET /print/status` so the admin UI can show a green dot for "reachable".
 * We don't trust node-thermal-printer's `isPrinterConnected` here — it
 * actually opens a session and writes a status query, which can hang on a
 * misbehaving printer. A bare TCP connect with a short timeout is enough
 * to know the host:port is live.
 */
export async function probePrinter(target: PrinterTarget): Promise<boolean> {
  if (!target.ip || target.ip.trim() === '') return false;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    try {
      socket.connect(target.port, target.ip);
    } catch {
      finish(false);
    }
  });
}

/**
 * Send a list of plain text lines to a network printer and cut. Suitable for
 * both kitchen comandas and customer receipts — the formatter decides what
 * goes on each line; we only care about getting bytes onto the wire.
 *
 * Returns `{ ok: false, error }` for any failure (no IP configured, connection
 * refused, timeout) so the caller can record/print the error without a 500.
 */
export async function sendLines(
  target: PrinterTarget,
  lines: string[],
): Promise<PrintResult> {
  if (!target.ip || target.ip.trim() === '') {
    return { ok: false, error: 'Printer IP is not configured' };
  }
  if (!Number.isFinite(target.port) || target.port <= 0) {
    return { ok: false, error: 'Printer port is invalid' };
  }
  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: makeInterface(target),
      width: paperWidthChars(target.width),
      options: { timeout: TCP_TIMEOUT_MS },
    });
    for (const line of lines) {
      printer.println(line);
    }
    printer.cut();
    await printer.execute();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Print failed';
    // Logged at warn level — printer outages are operational, not exceptional.
    logger.warn({ err, target: { ip: target.ip, port: target.port } }, 'Print failed');
    return { ok: false, error: message };
  }
}
