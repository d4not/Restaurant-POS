import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Capacitor loads index.html via the file:// scheme on Android, so all asset
// URLs need to be relative ('./'). We share the entire React tree from
// ../terminal/src via the @ alias — anything under @mobile is mobile-specific
// (platform adapters, mobile-only entry, mobile.css overrides).
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../terminal/src'),
      '@mobile': path.resolve(__dirname, 'src'),
      // The shared @ tree lives in ../terminal/src, so node_modules resolution
      // for those files walks up into terminal/node_modules first. That yields
      // a second physical copy of React in the bundle, which makes hooks blow
      // up at runtime ("Cannot read properties of null (reading 'useCallback')").
      // Pin every React import to terminal-mobile's own copy.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      // Same dedupe story for libraries that hold module-level state (React
      // context, zustand store maps): two copies = two contexts = providers
      // and consumers can't see each other.
      '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
      zustand: path.resolve(__dirname, 'node_modules/zustand'),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query', 'zustand'],
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
});
