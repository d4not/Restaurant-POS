import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron's renderer loads the bundle via the file:// scheme in production,
// so all asset URLs need to be relative ('./'). In dev we serve from
// http://localhost:5173 (Electron points there with loadURL when ELECTRON_DEV=1).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
