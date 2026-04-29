import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the Express backend during `npm run dev`.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Uploaded images are served by the backend at /uploads/*; proxy them
      // here so <img src="/uploads/<uuid>.png"> works in the dev SPA.
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
