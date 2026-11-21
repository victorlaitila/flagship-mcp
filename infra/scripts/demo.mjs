// Takes the public demo down or brings it back, using the kill switch: `npm run demo:stop` / `npm run demo:restore`.
// Stop leaves the web page up but refuses all API and live-update traffic. Needs `aws sso login --profile flagship`.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const action = process.argv[2];
if (action !== 'stop' && action !== 'restore') throw new Error('Usage: demo.mjs stop|restore');
const out = join(tmpdir(), 'flagship-kill-switch.json');
execFileSync('aws', [
  'lambda', 'invoke', '--profile', 'flagship', '--region', 'us-east-1', '--function-name', 'flagship-kill-switch',
  '--cli-binary-format', 'raw-in-base64-out', '--payload', JSON.stringify(action === 'restore' ? { action } : {}), out,
], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(JSON.parse(readFileSync(out, 'utf8')));
rmSync(out);
