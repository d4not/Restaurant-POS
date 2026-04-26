# POS Terminal Mobile — Implementation Plan

## Phase 0: Backend print endpoints
```
Read @CLAUDE.md and @SPEC.md sections 3 and 5.

Add server-side printing to the backend so tablets can request prints via API.

1. Install node-thermal-printer if not already present
2. Add printer settings to the Settings table (seed them):
   - printer_kitchen_ip, printer_kitchen_port (default 9100)
   - printer_receipt_ip, printer_receipt_port (default 9100)
   - printer_paper_width (default 80)
   - business_name, business_address
3. Create src/modules/print/ module:
   - service.ts: buildKitchenComanda(orderId) and buildReceipt(orderId)
   - Format ESC/POS commands matching the formats in @docs/TERMINAL-SPEC.md
   - Connect to printer via TCP (ip:port from settings)
   - Handle connection errors gracefully (return error, don't crash)
4. Endpoints:
   - POST /api/v1/print/kitchen { order_id } — prints comanda
   - POST /api/v1/print/receipt { order_id } — prints receipt
   - GET /api/v1/print/status — returns printer connection status
5. Add GET/PATCH /api/v1/settings endpoints if they don't exist (key-value CRUD)
6. Add printer settings to the admin Settings page

Write tests for comanda and receipt formatting. Test with a mock TCP server if possible.

Acceptance criteria:
- POST /print/kitchen returns 200 and sends ESC/POS bytes to configured IP:port
- POST /print/receipt returns 200 with formatted receipt data
- GET /print/status returns connection status for both printers
- Settings CRUD works for printer configuration
- Existing tests still pass
```

## Phase 1: Platform abstraction layer
```
Read @CLAUDE.md and @SPEC.md section 4.

Create a platform abstraction layer in the SHARED terminal code so it works on both Electron and Capacitor.

1. Create terminal/src/platform/types.ts with PlatformBridge interface:
   - print: { kitchen(orderId), receipt(orderId), status() }
   - storage: { get(key), set(key, value), remove(key) }
   - haptics: { tap(), success(), error() }
   - network: { isConnected(), onStatusChange(cb) }

2. Create terminal/src/platform/electron.ts implementing PlatformBridge:
   - print: uses existing window.electron.printKitchen/printReceipt IPC
   - storage: wraps localStorage
   - haptics: no-op functions
   - network: navigator.onLine + window events

3. Create terminal/src/platform/web.ts (fallback for browser dev):
   - print: console.log('[PRINT]', ...) for development
   - storage: localStorage
   - haptics: no-op
   - network: navigator.onLine

4. Create terminal/src/platform/index.ts:
   - Detects platform (electron/capacitor/web)
   - Exports getPlatformBridge() that returns the right implementation
   - Capacitor implementation will be provided by terminal-mobile in Phase 2

5. Update the existing Electron terminal code:
   - Replace direct window.electron.printKitchen calls with getPlatformBridge().print.kitchen
   - Replace localStorage auth token with getPlatformBridge().storage
   - This is a refactor — behavior must stay identical

6. Verify the Electron terminal still works exactly as before after the refactor.

Acceptance criteria:
- terminal/src/platform/ exists with types, electron, web, and index files
- All existing terminal functionality works via the abstraction layer
- No direct window.electron or localStorage calls remain in shared components
- Electron terminal launches and all features work
- npm run build in terminal/ succeeds
```

## Phase 2: Capacitor project scaffold
```
Read @CLAUDE.md and @SPEC.md sections 5, 6, 7.

Create the terminal-mobile/ Capacitor project.

1. Create terminal-mobile/ folder at project root
2. Initialize: npm init, install dependencies:
   - @capacitor/core, @capacitor/cli, @capacitor/android
   - @capacitor/preferences, @capacitor/network, @capacitor/haptics
   - @capacitor/splash-screen, @capacitor/status-bar
   - react, react-dom, vite, @vitejs/plugin-react, typescript
   - @tanstack/react-query, zustand (same versions as terminal/)

3. Create capacitor.config.ts per SPEC.md section 5
4. Create vite.config.ts with aliases to ../terminal/src/ per SPEC.md section 7
5. Create index.html (entry for Capacitor WebView)
6. Create tsconfig.json extending shared config

7. Create terminal-mobile/src/main-mobile.tsx:
   - Imports App from @/App (shared terminal code)
   - Registers Capacitor platform bridge before rendering
   - Wraps with necessary providers

8. Create terminal-mobile/src/platform/ adapters:
   - printer.ts: calls POST /api/v1/print/kitchen and /receipt
   - storage.ts: wraps @capacitor/preferences
   - haptics.ts: wraps @capacitor/haptics
   - network.ts: wraps @capacitor/network

9. Create terminal-mobile/src/styles/mobile.css per SPEC.md section 6

10. Run: npm run build → npx cap add android → npx cap sync android

11. Configure AndroidManifest.xml:
    - Landscape orientation lock
    - Cleartext traffic allowed (local network)

12. Verify: the app opens in Android Studio emulator showing the PIN screen

Acceptance criteria:
- terminal-mobile/ folder exists with all config files
- npm run build produces dist/ with no errors
- npx cap sync android completes successfully
- Android project opens in Android Studio
- App launches in emulator in landscape orientation
- PIN login screen is visible
- The shared terminal UI renders correctly
```

## Phase 3: Mobile-specific features
```
Read @CLAUDE.md and @SPEC.md sections 4, 6.

Add tablet-specific behavior to the app.

1. Network status monitoring:
   - Use @capacitor/network to detect connectivity changes
   - Show persistent orange "Offline" banner at top when disconnected
   - Banner disappears when connection restores
   - TanStack Query retries automatically on reconnection

2. Secure storage:
   - Auth token stored via @capacitor/preferences (not localStorage)
   - Token persists across app restarts
   - Clear on logout/sign out

3. Haptic feedback:
   - Light tap on button press
   - Success vibration on payment complete
   - Error vibration on failed action

4. Configurable backend URL:
   - In Settings view: add "Server URL" input field
   - Stored in Capacitor Preferences
   - Default: http://192.168.1.100:3000/api/v1
   - API client reads from this setting on startup
   - Show connection test button (pings /health endpoint)

5. Session management:
   - Auto-lock after 5 min idle (same as desktop) — redirect to PIN screen
   - On 401 from API: clear token, redirect to PIN with "Session expired" toast
   - Keep register OPEN on server when locking (only lock the UI)

6. Status bar:
   - Dark content on cream background (#f5f0e8)
   - Or hide status bar entirely for full-screen POS feel

Acceptance criteria:
- Offline banner appears when WiFi is toggled off in emulator
- Token survives app restart (no re-login needed)
- Buttons give haptic feedback
- Server URL is configurable and persisted
- Auto-lock works after idle timeout
```

## Phase 4: Build APK and test
```
Final integration and APK build.

1. Generate app icon and splash screen:
   - Use the warm brown/gold theme colors
   - Icon: simple "POS" text or coffee cup icon on cream background
   - Splash: business name centered on cream background
   - Place in terminal-mobile/resources/

2. Configure Android build:
   - Set app version: 1.0.0 (versionCode 1)
   - Set minSdk 26, targetSdk 34
   - Set landscape-only in AndroidManifest.xml (verify it stuck after cap sync)

3. Build debug APK:
   - cd terminal-mobile/android
   - ./gradlew assembleDebug
   - APK output: android/app/build/outputs/apk/debug/app-debug.apk

4. Full flow test on emulator:
   - Install APK
   - Configure server URL in settings
   - PIN login
   - Floor plan → create dine-in order
   - Add items with modifiers
   - Send to kitchen (verify backend receives print request)
   - Process payment
   - Verify receipt print request sent
   - Toggle airplane mode → offline banner
   - Re-enable → data refreshes

5. Copy APK to accessible location: cp to project root as pos-terminal.apk

Acceptance criteria:
- APK file exists and is under 30MB
- Installs on Android 10+ tablet/emulator
- Full order lifecycle works end-to-end
- Print requests reach backend API
- Offline detection works
- Landscape locked — rotation has no effect
```

---

## Tips for the operator

### Between phases
- Run `/clear` in Claude Code between every phase
- Commit after each phase: `git add -A && git commit -m "Terminal Mobile Phase X: ..."`

### Development workflow
- Use `npm run dev` in terminal-mobile/ for browser testing (faster iteration)
- Use `npx cap sync android && npx cap open android` to test in Android Studio
- For live reload on a physical tablet: set `server.url` in capacitor.config.ts to your dev machine IP

### Android Studio
- You need Android Studio installed: `sudo pacman -S android-studio` (Arch) or from https://developer.android.com
- First launch will download SDK components (~2GB)
- Create an emulator: API 34, tablet form factor, landscape

### Common pitfalls
- **Base path**: Capacitor loads files via `file://` — Vite must use `base: './'`
- **CORS**: Local network requests may fail — backend needs CORS configured for the tablet's origin
- **Cleartext**: Android blocks HTTP by default — `android:usesCleartextTraffic="true"` is required for local network
- **Cap sync**: Run `npx cap sync android` after EVERY `npm run build` — it copies dist/ to the Android project
- **Path aliases**: The Vite alias `@` must resolve to `../terminal/src/` — test with `npm run build` before syncing

### When to use Opus vs Sonnet
- Opus: Phase 1 (platform abstraction refactor — needs careful reasoning about what to change)
- Sonnet: Phases 0, 2, 3, 4 (straightforward implementation from clear specs)
