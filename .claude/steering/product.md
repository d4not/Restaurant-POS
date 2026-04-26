# Product Context — POS Terminal Mobile

## Why this exists
The café currently uses an Electron desktop app as the POS terminal. Waiters need to take orders at the table using tablets, but running Electron on Android is not viable. Capacitor wraps the same React UI in a native Android WebView, giving us a tablet app without rewriting the frontend.

## Who it's for
- **Primary**: Waiters carrying tablets to tables. They need fast product selection, quick modifier pickers, and "Send to Kitchen" in under 30 seconds per order.
- **Secondary**: The cashier, who might use a tablet at the counter instead of a desktop for a smaller/simpler setup.

## What success looks like
- A waiter can take a 4-item order with modifiers in under 60 seconds on the tablet
- The kitchen comanda prints within 2 seconds of tapping "Send to Kitchen"
- The app runs all day on a café's local network without crashes or freezes
- Zero training needed beyond "enter your PIN and tap the table"

## What failure looks like
- The app feels sluggish or "web-appy" — laggy scrolling, delayed taps
- Printing fails silently (order taken but kitchen never gets the comanda)
- Network drops kill the app instead of degrading gracefully
- The UI doesn't fit tablet screens properly (too small, too much whitespace)

## Roadmap
- v1.0: Core order-taking + kitchen printing via backend API (this spec)
- v1.1: Barista view (read-only order queue on a tablet at the bar)
- v1.2: Customer-facing display (second screen showing order to customer)
- v2.0: Offline queue with sync (take orders even without network)
