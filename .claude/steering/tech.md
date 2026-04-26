# Technical Decisions — POS Terminal Mobile

## Why Capacitor over React Native
React Native would require rewriting all UI components. Capacitor wraps the existing React + CSS app as-is in a WebView. The terminal UI is already built and tested — Capacitor lets us reuse 95%+ of the code.

## Why backend printing instead of direct Bluetooth/WiFi from tablet
1. Single config point: printer IPs configured once on the server, not on every tablet
2. No native plugins needed: avoids Capacitor plugin compatibility issues
3. Works identically on desktop and mobile: same API call
4. Simpler debugging: print jobs logged server-side
5. Trade-off: adds 1 network hop (~5ms on local network), acceptable latency

## Why not a PWA
A PWA could work but: (a) no haptic feedback, (b) harder to lock landscape, (c) browser chrome takes screen space, (d) harder to keep alive in background, (e) can't guarantee it won't get killed by Android. Capacitor gives us a real APK with native control.

## Why @capacitor/preferences over localStorage
localStorage is not encrypted on Android. Capacitor Preferences uses Android's SharedPreferences which can be backed by the Android Keystore for sensitive data. Auth tokens must not be in plaintext localStorage.

## Performance budget
- Initial load (cold start to PIN screen): < 3 seconds
- View transition: < 200ms
- Product grid render (50 products): < 100ms
- TanStack Query stale time: 30 seconds for products, 10 seconds for active orders

## Patterns we follow
- **Platform bridge**: all native access through the abstraction layer, never direct plugin imports in shared code
- **Optimistic UI**: add item to cart immediately, sync with backend async
- **Cache-first**: TanStack Query serves cached data while revalidating in background
- **Error boundaries**: React error boundaries around each major section so one crash doesn't kill the app

## Anti-patterns to avoid
- Don't use `document.addEventListener` for back button — use Capacitor's App plugin
- Don't use `window.location.href` for navigation — use React Router
- Don't fetch on every render — rely on TanStack Query caching
- Don't block the UI while waiting for print confirmation
