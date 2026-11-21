// Runs the API tests against DynamoDB Local in a throwaway Docker container (removed afterwards).
import { execFileSync, spawnSync } from 'node:child_process';

const IMAGE = 'amazon/dynamodb-local:3.3.2';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

// A random free host port, so it never collides with anything already running.
const container = docker('run', '--rm', '-d', '-p', '127.0.0.1::8000', IMAGE, '-jar', 'DynamoDBLocal.jar', '-inMemory');
let status = 1;
// Ctrl-C also reaches vitest; ignoring it here lets `finally` remove the container once vitest exits.
process.on('SIGINT', () => {});
try {
  const endpoint = `http://${docker('port', container, '8000')}`;
  for (let tries = 0; ; tries++) {
    try {
      await fetch(endpoint);
      break;
    } catch (error) {
      if (tries > 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  status = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, STORAGE: 'dynamodb', DYNAMODB_ENDPOINT: endpoint },
  }).status ?? 1;
} finally {
  docker('stop', container);
}
process.exit(status);
