// Tiny custom i18n. No react-i18next, no i18next — just a Zustand-backed
// language store, a t() lookup, and a useTranslation() hook with a stable
// reference. Keys are the source of truth (en.ts); es.ts mirrors them.
//
// Persistence model:
//   - Per-device default lives in localStorage so the PIN screen renders in
//     the user's preferred language even before the JWT is issued.
//   - Once authed, the language can be synced from the backend setting via
//     useTranslation().setLanguage(code, { persistRemote: true }).

import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { en, type TranslationKey } from './en';
import { es } from './es';
import { fetchLanguageSetting, updateLanguageSetting } from '../api/settings';

export type Language = 'en' | 'es';

const tables: Record<Language, Record<TranslationKey, string>> = {
  en: en as Record<TranslationKey, string>,
  es,
};

interface LanguageState {
  language: Language;
  setLanguageLocal: (language: Language) => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: 'en',
      setLanguageLocal: (language) => set({ language }),
    }),
    { name: 'pos-terminal-language' },
  ),
);

/**
 * Lookup a translation. Falls back to the English value when the current
 * language doesn't have the key, and to the raw key as a last resort. This
 * keeps the UI legible even if a translation is forgotten.
 */
export function t(key: TranslationKey | string): string {
  const language = useLanguageStore.getState().language;
  const table = tables[language] ?? tables.en;
  const value = (table as Record<string, string>)[key];
  if (value !== undefined) return value;
  const fallback = (tables.en as Record<string, string>)[key];
  return fallback ?? key;
}

interface UseTranslationApi {
  t: (key: TranslationKey | string) => string;
  language: Language;
  setLanguage: (
    language: Language,
    options?: { persistRemote?: boolean },
  ) => Promise<void>;
}

/**
 * React hook for components. Subscribes to the language store so the tree
 * re-renders when the operator switches language.
 */
export function useTranslation(): UseTranslationApi {
  const language = useLanguageStore((s) => s.language);

  const translate = useCallback(
    (key: TranslationKey | string) => {
      const table = tables[language] ?? tables.en;
      const value = (table as Record<string, string>)[key];
      if (value !== undefined) return value;
      const fallback = (tables.en as Record<string, string>)[key];
      return fallback ?? key;
    },
    [language],
  );

  const setLanguage = useCallback(
    async (next: Language, options?: { persistRemote?: boolean }) => {
      useLanguageStore.getState().setLanguageLocal(next);
      if (options?.persistRemote) {
        try {
          await updateLanguageSetting(next);
        } catch {
          // Server unreachable is not fatal — local preference still applies.
          // The next sync will retry.
        }
      }
    },
    [],
  );

  return { t: translate, language, setLanguage };
}

/**
 * Pull the persisted language from the backend and apply it locally. Called
 * from App.tsx after auth so the operator's choice follows them between
 * devices.
 */
export async function syncLanguageFromServer(): Promise<void> {
  try {
    const value = await fetchLanguageSetting();
    if (value === 'en' || value === 'es') {
      useLanguageStore.getState().setLanguageLocal(value);
    }
  } catch {
    // Silent — local preference remains.
  }
}
