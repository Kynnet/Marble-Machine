import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  root: 'web',
  // The Express server hands out built assets under /static/, so the bundle has
  // to name them that way. Dev stays at / so the Vite dev server still works.
  base: mode === 'production' ? '/static/' : '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: {
    root: process.cwd(),
    environment: 'node',
    include: ['server/**/*.test.js', 'web/src/**/*.test.js'],
  },
}));
