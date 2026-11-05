// Isolated Flagship stack on the normal ports (API :4000, web :5173) backed by a throwaway database,
// so the browser and Claude Code's `flagship` MCP server can be exercised without touching the dev database.
// Usage: node sandbox.mjs start [--keep-db] | stop [--keep-db] | status
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const STATE = join(tmpdir(), 'flagship-sandbox.json');
const DB = join(tmpdir(), 'flagship-sandbox.db');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:5173';
const [command, flag] = process.argv.slice(2);

const up = async (url) => fetch(url).then((r) => r.ok, () => false);
/** True if anything accepts connections on the port at either loopback address (the dev servers bind `localhost`, i.e. ::1). */
async function inUse(port) {
  for (const host of ['127.0.0.1', '::1']) {
    const open = await new Promise((done) => {
      const socket = connect(port, host)
        .once('connect', () => (socket.destroy(), done(true)))
        .once('error', () => done(false));
    });
    if (open) return true;
  }
  return false;
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const removeDb = () => ['', '-wal', '-shm'].forEach((s) => rmSync(DB + s, { force: true }));
const state = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null);

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    if (await up(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not come up; see ${join(tmpdir(), 'flagship-sandbox-*.log')}`);
}

function run(name, args, env) {
  const log = openSync(join(tmpdir(), `flagship-sandbox-${name}.log`), 'w');
  // Detached process group, so `stop` also ends the children npm/npx start.
  const child = spawn('npm', args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return child.pid;
}

if (command === 'start') {
  if (state()) fail('A sandbox is already running; stop it first.');
  if ((await inUse(4000)) || (await inUse(5173))) {
    fail('Ports 4000/5173 are in use (probably `npm run dev` on the dev database). Stop that first; the sandbox must not share them.');
  }
  if (flag !== '--keep-db') removeDb();
  const api = run('api', ['start', '-w', '@flagship/api'], { PORT: '4000', DATABASE_PATH: DB });
  const web = run('web', ['run', 'dev', '-w', '@flagship/web', '--', '--port', '5173', '--strictPort'], { API_URL: API });
  writeFileSync(STATE, JSON.stringify({ api, web }));
  await waitFor(`${API}/api/health`);
  await waitFor(WEB);
  console.log(`Sandbox running on a throwaway database (${DB}).\n  Dashboard ${WEB}\n  Storefront ${WEB}/store\n  API ${API}\nClaude Code's flagship MCP server now talks to this sandbox (reconnect with /mcp if it was started before).`);
} else if (command === 'stop') {
  const s = state();
  if (!s) {
    console.log('No sandbox running.');
  } else {
    for (const pid of [s.api, s.web]) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch { /* already gone */ }
    }
    rmSync(STATE, { force: true });
    if (flag !== '--keep-db') removeDb();
    console.log(`Sandbox stopped${flag === '--keep-db' ? ` (database kept at ${DB})` : ' and its database removed'}.`);
  }
} else if (command === 'status') {
  const s = state();
  console.log(s
    ? `Sandbox: API ${(await up(`${API}/api/health`)) ? 'up' : 'DOWN'}, web ${(await up(WEB)) ? 'up' : 'DOWN'} (pids ${s.api}, ${s.web}).`
    : 'No sandbox running.');
} else {
  console.log('Usage: node sandbox.mjs start [--keep-db] | stop [--keep-db] | status');
  process.exit(1);
}
