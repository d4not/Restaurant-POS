import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.restaurantpos.terminal',
  appName: 'POS Terminal',
  webDir: 'dist',
  server: {
    // App loads from http://localhost so cross-origin fetches to the LAN
    // backend (also http://) aren't blocked as mixed content. Combined with
    // android:usesCleartextTraffic="true" in the manifest this lets the
    // tablet reach the dev backend without TLS.
    androidScheme: 'http',
    // For dev with live-reload against a Vite server on the LAN, uncomment
    // and set to your machine IP. Leave commented to ship a static build.
    // url: 'http://192.168.1.100:5174',
    // cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#f5f0e8',
    },
    // LIGHT in Capacitor speak = dark icons/text on a light backdrop, which
    // matches the warm cream theme of the app shell. Status bar background
    // stays cream so it visually merges with the topbar.
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#f5f0e8',
    },
  },
};

export default config;
