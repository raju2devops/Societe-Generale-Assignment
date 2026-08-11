import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server proxies /api to the backend so the browser sees a single origin.
 * That keeps the auth cookies same-site in development exactly as they are in
 * production, instead of relying on a relaxed CORS/SameSite setup that would
 * then have to be tightened before release.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // do not ship source maps to production users
    target: 'es2020',
  },
});
