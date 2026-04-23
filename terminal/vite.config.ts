import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// Vite + Electron. Renderer runs at :5174 in dev (5173 is taken by the admin
// panel) and proxies /api → backend at :3000 so the same VITE_API_URL trick
// works in dev and prod. Electron main + preload are bundled separately into
// dist-electron/ so the packaged app can require them.
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: { format: 'es', entryFileNames: '[name].js' },
              external: ['electron'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // CommonJS keeps Electron's preload sandbox happy across
              // versions — ESM preload requires the contextBridge bootstrap to
              // be configured per-window, and we don't need that yet.
              // Emit as .cjs so Node ignores package.json "type": "module"
              // and loads the file as CommonJS.
              output: { format: 'cjs', entryFileNames: '[name].cjs' },
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
