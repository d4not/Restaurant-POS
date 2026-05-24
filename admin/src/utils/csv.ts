/**
 * Tiny CSV exporter. Handles the only escaping rule that matters: double-quote
 * cells that contain a comma, quote, or newline; double up internal quotes.
 *
 * Usage:
 *   downloadCsv('sales-2026-01.csv', [
 *     ['Date', 'Order #', 'Total'],
 *     ['2026-01-15', '123', '450.00'],
 *   ]);
 */

function escapeCell(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

export function downloadCsv(
  filename: string,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): void {
  // BOM lets Excel auto-detect UTF-8 instead of mangling accented characters.
  const blob = new Blob(['﻿', toCsv(rows)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke so the click has time to start the download in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/** Build a `report-yyyy-mm-dd_to_yyyy-mm-dd.csv` filename. */
export function csvFilename(prefix: string, from: string, to: string): string {
  return `${prefix}_${from}_to_${to}.csv`;
}
