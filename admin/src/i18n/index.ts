// Tiny custom i18n for the admin panel. Mirrors the terminal implementation —
// Zustand-backed language store + a t() lookup with English fallback. The two
// stores are deliberately independent so the admin and a tablet on the same
// LAN can run different languages if a user prefers.

import { useCallback } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { en, type TranslationKey } from './en';
import { es } from './es';
import { api } from '../api/client';

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
    {
      name: 'pos-admin-language',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

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
          await api.patch<{ value: string }>('/settings/language', {
            value: next,
          });
        } catch {
          /* server unreachable — local preference still applies */
        }
      }
    },
    [],
  );

  return { t: translate, language, setLanguage };
}

/**
 * Pull the persisted language from the backend. Called once at startup so the
 * admin reflects the operator's saved choice on every device.
 */
export async function syncLanguageFromServer(): Promise<void> {
  try {
    const data = await api.get<{ value: string }>('/settings/language');
    if (data.value === 'en' || data.value === 'es') {
      useLanguageStore.getState().setLanguageLocal(data.value);
    }
  } catch {
    /* silent — local preference still wins */
  }
}
