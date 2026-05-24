/**
 * Local i18n namespace for the cash-count flow. Lives next to the components
 * (rather than in `terminal/src/i18n/{en,es}.ts`) because Track A must not
 * touch the parallel-agent-owned i18n tables. Track B will merge these keys
 * into the global table once the shifts refactor lands.
 *
 * The helper plugs into the same Zustand language store as the global t() so
 * a language switch in any other part of the app re-renders cash-count
 * components too.
 */

import { useCallback } from 'react';
import { useLanguageStore, type Language } from '../../i18n';

type Strings = Record<string, string>;

const en: Strings = {
  'cashCount.title': 'Cash count',
  'cashCount.bills': 'Bills',
  'cashCount.coins': 'Coins',
  'cashCount.total': 'Total',
  'cashCount.expected': 'Expected',
  'cashCount.difference': 'Difference',
  'cashCount.diff.short': 'short',
  'cashCount.diff.over': 'over',
  'cashCount.diff.balanced': 'Balanced',
  'cashCount.count': 'Count',
  'cashCount.subtotal': 'Subtotal',
  'cashCount.reset': 'Reset',
  'cashCount.suggest': 'Suggest from expected',
  'cashCount.blind.banner':
    'Blind count — finish counting before the expected amount is revealed.',
  'cashCount.empty': 'No bills or coins counted yet.',
  'cashCount.notify': 'Notify manager',

  'cashCount.hint.balanced.title': 'Cash matches expected',
  'cashCount.hint.balanced.detail':
    'Counted amount equals expected. Ready to close.',

  'cashCount.hint.singleShort.title': 'You may be missing {{count}} × {{denom}}',
  'cashCount.hint.singleOver.title': 'You may have {{count}} × {{denom}} extra',
  'cashCount.hint.single.detail':
    'Recount that pile first — diff matches exactly.',

  'cashCount.hint.combo.title': 'No single denomination matches',
  'cashCount.hint.combo.detail':
    'Closest decomposition: {{summary}}. Recount the larger denominations first.',

  'cashCount.hint.notify.title': 'Notify the manager',
  'cashCount.hint.notify.detail':
    'Variance ({{amount}}) is above the notify threshold. Flag this close for review.',

  'cashCount.hint.blocking.title': 'Manager approval required',
  'cashCount.hint.blocking.detail':
    'Variance ({{amount}}) is above the blocking threshold. A manager+ must sign off before closing.',

  'cashCount.hint.unknown.title': 'Unusual variance',
  'cashCount.hint.unknown.detail':
    'Diff of {{amount}} doesn’t map to a typical bill/coin combo — recount the drawer end-to-end.',
};

const es: Strings = {
  'cashCount.title': 'Conteo de efectivo',
  'cashCount.bills': 'Billetes',
  'cashCount.coins': 'Monedas',
  'cashCount.total': 'Total',
  'cashCount.expected': 'Esperado',
  'cashCount.difference': 'Diferencia',
  'cashCount.diff.short': 'faltante',
  'cashCount.diff.over': 'sobrante',
  'cashCount.diff.balanced': 'Cuadra',
  'cashCount.count': 'Cantidad',
  'cashCount.subtotal': 'Subtotal',
  'cashCount.reset': 'Reiniciar',
  'cashCount.suggest': 'Sugerir desde esperado',
  'cashCount.blind.banner':
    'Conteo ciego — termina de contar antes de ver el monto esperado.',
  'cashCount.empty': 'Aún no se han contado billetes ni monedas.',
  'cashCount.notify': 'Avisar al gerente',

  'cashCount.hint.balanced.title': 'La caja cuadra',
  'cashCount.hint.balanced.detail':
    'El monto contado coincide con el esperado. Listo para cerrar.',

  'cashCount.hint.singleShort.title':
    'Podría faltarte {{count}} × {{denom}}',
  'cashCount.hint.singleOver.title':
    'Podrías tener {{count}} × {{denom}} de más',
  'cashCount.hint.single.detail':
    'Revisa esa pila primero — la diferencia coincide exacto.',

  'cashCount.hint.combo.title': 'Ningún billete o moneda solo lo explica',
  'cashCount.hint.combo.detail':
    'Descomposición más simple: {{summary}}. Recuenta primero las denominaciones grandes.',

  'cashCount.hint.notify.title': 'Avisa al gerente',
  'cashCount.hint.notify.detail':
    'La diferencia ({{amount}}) supera el umbral de aviso. Marca este cierre para revisión.',

  'cashCount.hint.blocking.title': 'Se requiere aprobación de gerente',
  'cashCount.hint.blocking.detail':
    'La diferencia ({{amount}}) supera el umbral bloqueante. Un gerente+ debe autorizar antes de cerrar.',

  'cashCount.hint.unknown.title': 'Diferencia atípica',
  'cashCount.hint.unknown.detail':
    'La diferencia de {{amount}} no encaja con billetes/monedas comunes — recuenta toda la caja.',
};

const tables: Record<Language, Strings> = { en, es };

/** Resolve placeholders of the form `{{name}}` from a params object. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = params[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Hook variant — subscribes to the language store so the component re-renders on switch. */
export function useCashCountT() {
  const language = useLanguageStore((s) => s.language);
  return useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const table = tables[language] ?? tables.en;
      const value = table[key] ?? tables.en[key] ?? key;
      return interpolate(value, params);
    },
    [language],
  );
}

/** Imperative variant — for non-React callers (e.g. notifications dispatch). */
export function cashCountT(
  key: string,
  params?: Record<string, string | number>,
): string {
  const language = useLanguageStore.getState().language;
  const table = tables[language] ?? tables.en;
  const value = table[key] ?? tables.en[key] ?? key;
  return interpolate(value, params);
}
