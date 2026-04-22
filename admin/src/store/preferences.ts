import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Currency = 'MXN' | 'USD';
export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY';

interface PreferencesState {
  currency: Currency;
  dateFormat: DateFormat;
  setCurrency: (c: Currency) => void;
  setDateFormat: (f: DateFormat) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      currency: 'MXN',
      dateFormat: 'DD/MM/YYYY',
      setCurrency: (currency) => set({ currency }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
    }),
    {
      name: 'pos-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
