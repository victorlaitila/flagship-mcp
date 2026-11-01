import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated stack: its own API port, web port and a throwaway database that is deleted
// and re-seeded on every run. The normal development database is never touched.
const API_PORT = 4100;
const WEB_PORT = 5174;
const DATABASE_PATH = join(tmpdir(), 'flagship-e2e.db');

export default defineConfig({
  testDir: 'e2e',
  // Tests share one API and database, so run them one at a time; each restores what it changes.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: `node -e "for (const s of ['', '-wal', '-shm']) require('fs').rmSync(process.env.DATABASE_PATH + s, { force: true })" && npm start -w @flagship/api`,
      env: { PORT: String(API_PORT), DATABASE_PATH },
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -w @flagship/web -- --port ${WEB_PORT} --strictPort`,
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
