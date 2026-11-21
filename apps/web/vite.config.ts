import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const api = process.env.API_URL ?? 'http://localhost:4000';

// `ws: true` also proxies the live-update WebSocket (/api/live). A dead connection is detected by the
// client's ping/pong watchdog (STALE_AFTER_MS in src/hooks/useLive.ts), so the proxy needs nothing else.
const proxy: Record<string, ProxyOptions> = {
  '/api': { target: api, ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
