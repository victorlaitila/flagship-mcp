import type { Server } from 'node:http';
import { LIVE_PATH, LIVE_PING, type LiveMessage } from '@flagship/shared';
import { WebSocketServer } from 'ws';
import type { ChangeNotifier } from './events.js';

const PONG = JSON.stringify({ type: 'pong' } satisfies LiveMessage);

/**
 * Live updates over WebSocket at /api/live: every committed change is sent as `{ type: 'change', event }`.
 * Clients send LIVE_PING and get a pong, which is how they detect a dead connection.
 */
export function attachLiveUpdates(server: Server, notifier: ChangeNotifier): WebSocketServer {
  // Clients only ever send pings, so anything large is refused.
  const wss = new WebSocketServer({ server, path: LIVE_PATH, maxPayload: 1024 });
  wss.on('connection', (socket) => {
    const unsubscribe = notifier.subscribe((event) => socket.send(JSON.stringify({ type: 'change', event } satisfies LiveMessage)));
    socket.on('message', (data) => {
      if (data.toString() === LIVE_PING) socket.send(PONG);
    });
    socket.on('close', unsubscribe);
    socket.on('error', () => socket.terminate());
  });
  return wss;
}
