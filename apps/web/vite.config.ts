import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const api = process.env.API_URL ?? 'http://localhost:4000';

// When the API goes away, end the browser's side of a proxied response too. Otherwise an open
// live-update stream (/api/events) silently hangs instead of failing and reconnecting.
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: api,
    configure: (server) => {
      server.on('proxyRes', (proxyRes, _req, res) => {
        proxyRes.on('close', () => {
          if (!res.writableEnded) res.destroy();
        });
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
