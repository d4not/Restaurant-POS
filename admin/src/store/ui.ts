import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Default-open the groups that contain the first few routes so the navigation
 * matches the mockup's resting state. Users can collapse them individually.
 */
const DEFAULT_OPEN_GROUPS = ['reportes', 'inventario', 'menu', 'personal', 'sistema'];

interface UiState {
  openGroups: string[];
  toggleGroup: (id: string) => void;
  isGroupOpen: (id: string) => boolean;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      openGroups: DEFAULT_OPEN_GROUPS,
      toggleGroup: (id) =>
        set((state) => ({
          openGroups: state.openGroups.includes(id)
            ? state.openGroups.filter((x) => x !== id)
            : [...state.openGroups, id],
        })),
      isGroupOpen: (id) => get().openGroups.includes(id),
    }),
    {
      name: 'pos-ui',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
