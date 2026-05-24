import { create } from 'zustand';

export type TerminalView = 'floor' | 'orders' | 'history' | 'detail' | 'admin' | 'waste';

// Views the admin mode is allowed to return to on Esc. Stored separately so a
// stale 'admin' or 'detail' / 'waste' never becomes the back target.
type AdminReturnView = Exclude<TerminalView, 'admin' | 'detail' | 'waste'>;

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
  settingsInitialSection: string | null;
  // Sticky session flag set the first time a cashier+ unlocks Order History
  // with their PIN. Cleared on PIN-screen lock / sign-out via signOutUi().
  historyUnlocked: boolean;
  // Where admin mode returns to on Esc / Back. Captured on openAdmin().
  adminReturnView: AdminReturnView;
  setView: (view: TerminalView) => void;
  openOrderDetail: (orderId: string) => void;
  openOrderPayment: (orderId: string) => void;
  consumePendingPayment: () => void;
  closeOrderDetail: () => void;
  openWaste: () => void;
  closeWaste: () => void;
  toggleMenu: () => void;
  closeMenu: () => void;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
  unlockHistory: () => void;
  openAdmin: () => void;
  closeAdmin: () => void;
  resetSession: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: 'orders',
  detailOrderId: null,
  pendingPaymentForOrderId: null,
  menuOpen: false,
  settingsOpen: false,
  settingsInitialSection: null,
  historyUnlocked: false,
  adminReturnView: 'orders',
  setView: (view) => set({ view, menuOpen: false }),
  openOrderDetail: (orderId) =>
    set({ view: 'detail', detailOrderId: orderId, pendingPaymentForOrderId: null, menuOpen: false }),
  openOrderPayment: (orderId) =>
    set({ view: 'detail', detailOrderId: orderId, pendingPaymentForOrderId: orderId, menuOpen: false }),
  consumePendingPayment: () => set({ pendingPaymentForOrderId: null }),
  closeOrderDetail: () => set({ view: 'orders', pendingPaymentForOrderId: null, menuOpen: false }),
  openWaste: () => set({ view: 'waste', menuOpen: false }),
  // Return to the active orders list; the cashier opened Waste from the hub
  // and that hub was on top of whatever screen they had — going to 'orders'
  // is the safe default.
  closeWaste: () => set({ view: 'orders', menuOpen: false }),
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  closeMenu: () => set({ menuOpen: false }),
  openSettings: (section?: string) => set({ settingsOpen: true, menuOpen: false, settingsInitialSection: section ?? null }),
  closeSettings: () => set({ settingsOpen: false, settingsInitialSection: null }),
  unlockHistory: () => set({ historyUnlocked: true }),
  openAdmin: () => {
    // Remember where we came from so Esc lands the operator back on the same
    // screen. 'detail' is normalised to 'orders' — popping straight back into
    // a half-built ticket would be jarring.
    const current = get().view;
    const safeReturn: AdminReturnView =
      current === 'admin' || current === 'detail' || current === 'waste'
        ? 'orders'
        : current;
    set({ view: 'admin', adminReturnView: safeReturn, menuOpen: false });
  },
  closeAdmin: () => set({ view: get().adminReturnView, menuOpen: false }),
  resetSession: () =>
    set({
      view: 'orders',
      detailOrderId: null,
      pendingPaymentForOrderId: null,
      menuOpen: false,
      settingsOpen: false,
      settingsInitialSection: null,
      historyUnlocked: false,
      adminReturnView: 'orders',
    }),
}));
