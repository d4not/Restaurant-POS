import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Per-report saved-filter store. Each entry is a named bag of opaque chip data
 * — the report itself decides what shape its chips take. Keeping the value as
 * `unknown` here means we can reuse this store for SalesReport, etc. later
 * without changing the schema.
 */

export interface SavedFilterSet<T = unknown> {
  id: string;
  name: string;
  chips: T;
  /** ISO timestamp of last save — surfaced in the UI as "saved 5 min ago". */
  saved_at: string;
}

interface SavedFiltersState {
  /** keyed by reportKey ('products-sold', 'sales', …) */
  byReport: Record<string, SavedFilterSet[]>;
  save: (reportKey: string, name: string, chips: unknown) => string;
  rename: (reportKey: string, id: string, name: string) => void;
  remove: (reportKey: string, id: string) => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useSavedReportFiltersStore = create<SavedFiltersState>()(
  persist(
    (set) => ({
      byReport: {},
      save: (reportKey, name, chips) => {
        const id = uid();
        set((s) => {
          const existing = s.byReport[reportKey] ?? [];
          const next: SavedFilterSet = {
            id,
            name: name.trim() || 'Untitled',
            chips,
            saved_at: new Date().toISOString(),
          };
          return {
            byReport: { ...s.byReport, [reportKey]: [...existing, next] },
          };
        });
        return id;
      },
      rename: (reportKey, id, name) =>
        set((s) => {
          const existing = s.byReport[reportKey] ?? [];
          return {
            byReport: {
              ...s.byReport,
              [reportKey]: existing.map((f) =>
                f.id === id ? { ...f, name: name.trim() || f.name } : f,
              ),
            },
          };
        }),
      remove: (reportKey, id) =>
        set((s) => {
          const existing = s.byReport[reportKey] ?? [];
          return {
            byReport: {
              ...s.byReport,
              [reportKey]: existing.filter((f) => f.id !== id),
            },
          };
        }),
    }),
    {
      name: 'pos-saved-report-filters',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export function useSavedFilters<T>(reportKey: string) {
  const all = useSavedReportFiltersStore((s) => s.byReport[reportKey]);
  const save = useSavedReportFiltersStore((s) => s.save);
  const rename = useSavedReportFiltersStore((s) => s.rename);
  const remove = useSavedReportFiltersStore((s) => s.remove);
  return {
    saved: (all ?? []) as SavedFilterSet<T>[],
    save:   (name: string, chips: T) => save(reportKey, name, chips),
    rename: (id: string, name: string) => rename(reportKey, id, name),
    remove: (id: string) => remove(reportKey, id),
  };
}
