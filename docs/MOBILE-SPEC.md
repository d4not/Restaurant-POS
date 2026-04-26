# POS Terminal Mobile — Technical Specification

## 1. Vision and scope

### In scope
- Android tablet app (APK) wrapping the existing POS terminal React UI
- Capacitor native shell with landscape lock
- Platform abstraction layer for printing, storage, haptics, network
- Backend-delegated printing (kitchen + receipt printers via API)
- Configurable backend URL for local network deployment
- Secure token storage via Capacitor Preferences
- Offline detection with graceful degradation
- Tablet-optimized touch targets and CSS overrides

### Out of scope (v1)
- iOS support (future)
- Bluetooth printing (using WiFi/network via backend)
- Push notifications
- Background sync / offline queue with retry
- Play Store distribution (sideload APK for now)
- Barcode scanner hardware integration

### Quality bars
- App cold start to PIN screen: < 3 seconds on mid-range tablet
- Navigation between views: < 200ms perceived
- Print command to backend response: < 500ms on local network
- Zero crashes on happy path flows

## 2. User flows

### Happy path: Waiter takes order on tablet
1. Waiter enters 4-digit PIN → authenticated
2. Sees Floor Plan → taps available table → order created
3. Product grid appears → taps products → variant/modifier pickers → items added to cart
4. Taps "Send to Kitchen" → POST to backend → backend prints comanda on kitchen printer
5. Taps "Hold" → returns to Floor Plan
6. Later: cashier opens order on desktop → processes payment

### Happy path: Cashier uses tablet at counter
1. Cashier enters PIN → sees Active Orders
2. Taps "+ New Order" → Takeout order created
3. Adds items → sends to kitchen → processes payment on tablet
4. Payment complete → backend prints receipt

### Edge case: Network lost during order
1. App detects WiFi disconnection via @capacitor/network
2. Orange "Offline" banner appears at top
3. User can still browse the last-loaded product grid (cached by TanStack Query)
4. Any API call shows "Cannot connect to server. Check your network."
5. When connection restores: banner disappears, data refreshes automatically

### Edge case: Backend unreachable but WiFi connected
1. API calls timeout after 5 seconds
2. Same "Cannot connect to server" message
3. App remains usable for viewing cached data

### Edge case: Session expires
1. Any 401 response → clear token → redirect to PIN screen
2. Show toast: "Session expired. Please sign in again."

## 3. Domain model

No new entities. The mobile app consumes the existing backend API. The only new backend additions are print endpoints.

### New backend endpoints

```
POST /api/v1/print/kitchen
Body: { order_id: UUID }
- Looks up order with items, modifiers, table, waiter
- Formats comanda in ESC/POS
- Sends to kitchen printer via TCP (printer IP:9100 from settings)
- Returns: { success: true }

POST /api/v1/print/receipt
Body: { order_id: UUID }
- Looks up order with payments, tax breakdown
- Formats receipt in ESC/POS
- Sends to receipt printer via TCP
- Returns: { success: true }

GET /api/v1/print/status
- Returns connection status of both printers
- { kitchen: { connected: boolean, name: string }, receipt: { connected: boolean, name: string } }
```

### New backend settings (in Settings table)

```
printer_kitchen_ip    — e.g., "192.168.1.50"
printer_kitchen_port  — default 9100
printer_receipt_ip    — e.g., "192.168.1.51"
printer_receipt_port  — default 9100
printer_paper_width   — 58 or 80 (mm)
business_name         — for receipt header
business_address      — for receipt header
```

## 4. Platform abstraction layer

The shared React code in terminal/src/ must NOT import Electron or Capacitor directly. Instead, it calls platform-agnostic functions that are implemented differently per platform.

```typescript
// terminal/src/platform/types.ts
interface PlatformBridge {
  print: {
    kitchen(orderId: string): Promise<void>;
    receipt(orderId: string): Promise<void>;
    status(): Promise<PrinterStatus>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  haptics: {
    tap(): void;
    success(): void;
    error(): void;
  };
  network: {
    isConnected(): Promise<boolean>;
    onStatusChange(cb: (connected: boolean) => void): () => void;
  };
}
```

### Electron implementation (terminal/src/platform/electron.ts)
- print: calls window.electron.printKitchen/printReceipt via IPC
- storage: localStorage (acceptable on desktop)
- haptics: no-op
- network: navigator.onLine

### Capacitor implementation (terminal-mobile/src/platform/adapters.ts)
- print: calls POST /api/v1/print/kitchen and /receipt
- storage: @capacitor/preferences
- haptics: @capacitor/haptics
- network: @capacitor/network

### Detection (terminal/src/platform/index.ts)
```typescript
import { Capacitor } from '@capacitor/core';

export function getPlatform(): 'electron' | 'capacitor' | 'web' {
  if (typeof window !== 'undefined' && (window as any).electron) return 'electron';
  if (Capacitor.isNativePlatform()) return 'capacitor';
  return 'web';
}
```

## 5. Android-specific configuration

### capacitor.config.ts
```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourcompany.posterminal',
  appName: 'POS Terminal',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // For dev: uncomment and set to your dev machine IP
    // url: 'http://192.168.1.100:5173',
    // cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#f5f0e8',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#2c2420',
    },
  },
};

export default config;
```

### AndroidManifest.xml overrides
- `android:screenOrientation="landscape"` on main activity
- `android:usesCleartextTraffic="true"` (local network HTTP)
- Permissions: INTERNET, ACCESS_NETWORK_STATE

### Build targets
- minSdk: 26 (Android 8.0)
- targetSdk: 34
- Build type: debug APK for sideloading (no Play Store signing needed)

## 6. Tablet CSS overrides (mobile.css)

```css
/* Ensure touch targets on tablet */
button, [role="button"], .clickable {
  min-height: 48px;
  min-width: 48px;
}

/* Hide scrollbars (touch scrolling) */
::-webkit-scrollbar { display: none; }

/* Prevent text selection on tap */
* { -webkit-user-select: none; user-select: none; }
input, textarea { -webkit-user-select: auto; user-select: auto; }

/* Disable pull-to-refresh */
body { overscroll-behavior: none; }

/* Safe area padding for notched tablets */
.app-root {
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

## 7. Vite configuration

```typescript
// terminal-mobile/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',  // Required for Capacitor file:// protocol
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../terminal/src'),
      '@mobile': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
```

## 8. Testing requirements

- All existing backend tests must pass after adding print endpoints
- Manual testing checklist:
  - [ ] APK installs on tablet
  - [ ] App launches in landscape
  - [ ] PIN login authenticates against backend on local network
  - [ ] Floor plan loads tables
  - [ ] Can create and modify orders
  - [ ] "Send to Kitchen" calls print API
  - [ ] Payment flow completes and calls receipt print API
  - [ ] Offline banner appears when WiFi drops
  - [ ] App survives device rotation attempt (stays landscape)

## 9. Acceptance criteria for v1

- [ ] `npx cap sync android` runs clean
- [ ] APK builds in Android Studio without errors
- [ ] App installs and runs on Android 10+ tablet in landscape
- [ ] PIN login → Floor Plan → Create Order → Add Items → Send to Kitchen → Pay → Receipt
- [ ] Backend print endpoints format and send ESC/POS to network printers
- [ ] Configurable backend URL in app settings
- [ ] Offline detection with visual indicator
- [ ] Session persisted in Capacitor Preferences (survives app restart)
- [ ] No TypeScript errors in terminal-mobile build

## 10. Open questions

None — all decisions have been made. Proceed with implementation.
