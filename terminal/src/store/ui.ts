import { create } from 'zustand';

export type TerminalView = 'floor' | 'orders' | 'history' | 'detail';

interface UiState {
  view: TerminalView;
  // When `view === 'detail'`, this is the order id being shown. When the user
  // navigates back to a list view, this stays populated until the next tap on
  // a different order (cheap, lets us re-open the most recently viewed order
  // without a server round-trip).
  detailOrderId: string | null;
  // Set when the cashier hits "Pay Order" from the active orders list — the
  // detail view watches this and pops the payment modal on mount. Cleared by
  // TableDetail once consumed so it doesn't re-trigger on every render.
  pendingPaymentForOrderId: string | null;
  menuOpen: boolean;
  settingsOpen: boolean;
  // Sticky session flag set the first time a cashier+ unlocks Order History
  // with their PIN. Cleared on PIN-screen lock / sign-out via signOutUi().
  historyUnlocked: boolean;
  setView: (view: TerminalView) => void;
  openOrderDetail: (orderId: string) => void;
  openOrderPayment: (orderId: string) => void;
  consumePendingPayment: () => void;
  closeOrderDetail: () => void;
  toggleMenu: () => void;
  closeMenu: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  unlockHistory: () => void;
  resetSession: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: 'orders',
  detailOrderId: null,
  pendingPaymentForOrderId: null,
  menuOpen: false,
  settingsOpen: false,
  historyUnlocked: false,
  setView: (view) => set({ view, menuOpen: false }),
  openOrderDetail: (orderId) =>
    set({ view: 'detail', detailOrderId: orderId, pendingPaymentForOrderId: null, menuOpen: false }),
  openOrderPayment: (orderId) =>
    set({ view: 'detail', detailOrderId: orderId, pendingPaymentForOrderId: orderId, menuOpen: false }),
  consumePendingPayment: () => set({ pendingPaymentForOrderId: null }),
  closeOrderDetail: () => set({ view: 'orders', pendingPaymentForOrderId: null, menuOpen: false }),
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  closeMenu: () => set({ menuOpen: false }),
  openSettings: () => set({ settingsOpen: true, menuOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  unlockHistory: () => set({ historyUnlocked: true }),
  resetSession: () =>
    set({
      view: 'orders',
      detailOrderId: null,
      pendingPaymentForOrderId: null,
      menuOpen: false,
      settingsOpen: false,
      historyUnlocked: false,
    }),
}));
