import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.FLOWQA_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Saat development, request /api/* dan /demo-api/* diteruskan ke server backend.
    // Pakai regex agar halaman SPA seperti /apis (API Catalog) tidak ikut diteruskan.
    proxy: { '^/api/': API_TARGET, '^/demo-api/': API_TARGET },
  },
});
