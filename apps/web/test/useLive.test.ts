import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Stand-in for the browser's WebSocket that the test drives by hand. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  fail() {
    this.onclose?.();
  }
  emit(data: string) {
    this.onmessage?.({ data });
  }
}

const change = (event: object) => JSON.stringify({ type: 'change', event });
const latest = () => FakeWebSocket.instances.at(-1)!;
let live: typeof import('../src/hooks/useLive');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules(); // fresh module state (one shared connection per app) for every test
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });
  live = await import('../src/hooks/useLive');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live updates connection', () => {
  it('opens one shared connection for all subscribers and delivers change events', () => {
    const a = vi.fn();
    const b = vi.fn();
    live.subscribeToChanges(a);
    live.subscribeToChanges(b);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latest().url).toBe('ws://localhost:5173/api/live');

    latest().open();
    latest().emit(change({ entity: 'config', flagKey: 'new_search', environment: 'staging', auditId: 7 }));
    latest().emit('{not json');
    latest().emit(JSON.stringify({ type: 'pong' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ entity: 'config', flagKey: 'new_search', environment: 'staging', auditId: 7 });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to unsubscribed listeners', () => {
    const listener = vi.fn();
    const unsubscribe = live.subscribeToChanges(listener);
    latest().open();
    unsubscribe();
    latest().emit(change({ entity: 'flag', flagKey: 'x', auditId: 1 }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('reconnects with exponential backoff up to the maximum delay, closing each failed connection', () => {
    live.subscribeToChanges(() => {});
    const delays = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
    for (const delay of delays) {
      const failed = latest();
      const count = FakeWebSocket.instances.length;
      failed.fail();
      expect(failed.closed).toBe(true);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(count); // not yet
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
    }
    // A successful connection resets the backoff.
    latest().open();
    latest().fail();
    vi.advanceTimersByTime(1000);
    expect(latest().closed).toBe(false);
  });

  it('never runs two connections at once', () => {
    live.subscribeToChanges(() => {});
    latest().fail();
    live.subscribeToChanges(() => {}); // a new subscriber while a retry is pending
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.filter((s) => !s.closed)).toHaveLength(1);
  });

  it('reports connecting, connected, reconnecting and disconnected accurately', () => {
    const seen: string[] = [];
    live.subscribeToLiveStatus(() => seen.push(live.getLiveStatus()));
    live.subscribeToChanges(() => {});
    expect(live.getLiveStatus()).toBe('connecting');
    latest().open();
    expect(live.getLiveStatus()).toBe('connected');
    latest().fail();
    expect(live.getLiveStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    latest().fail();
    expect(live.getLiveStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(2000);
    latest().fail();
    expect(live.getLiveStatus()).toBe('disconnected'); // third consecutive failure
    vi.advanceTimersByTime(4000);
    latest().open();
    expect(live.getLiveStatus()).toBe('connected');
    expect(seen).toEqual(['connected', 'reconnecting', 'disconnected', 'connected']);
  });

  it('asks subscribers to reload after a reconnect, but not on the first connect', () => {
    const listener = vi.fn();
    live.subscribeToChanges(listener);
    latest().open();
    expect(listener).not.toHaveBeenCalled();

    latest().fail();
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled(); // still disconnected: nothing to reload from yet
    latest().open();
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('also reloads once the very first connection succeeds after failing', () => {
    const listener = vi.fn();
    live.subscribeToChanges(listener);
    latest().fail(); // e.g. API down while the page loaded
    vi.advanceTimersByTime(1000);
    latest().open();
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('uses wss:// on an https page', async () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'demo.example' });
    live.subscribeToChanges(() => {});
    expect(latest().url).toBe('wss://demo.example/api/live');
  });

  it('pings while connected, and stops pinging a failed connection', () => {
    live.subscribeToChanges(() => {});
    const first = latest();
    vi.advanceTimersByTime(live.PING_INTERVAL_MS);
    expect(first.sent).toEqual([]); // not before it opens
    first.open();
    vi.advanceTimersByTime(live.PING_INTERVAL_MS);
    first.emit(JSON.stringify({ type: 'pong' }));
    vi.advanceTimersByTime(live.PING_INTERVAL_MS);
    expect(first.sent).toEqual(['{"type":"ping"}', '{"type":"ping"}']);
    expect(first.closed).toBe(false);
    first.fail();
    vi.advanceTimersByTime(live.PING_INTERVAL_MS * 2);
    expect(first.sent).toHaveLength(2);
  });

  it('treats a ping that gets no answer as a dead connection and reconnects', () => {
    live.subscribeToChanges(() => {});
    const first = latest();
    first.open();
    // Answered pings keep it alive for as long as it runs...
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(live.PING_INTERVAL_MS);
      first.emit(JSON.stringify({ type: 'pong' }));
    }
    expect(first.closed).toBe(false);
    expect(live.getLiveStatus()).toBe('connected');
    // ...an unanswered one does not.
    vi.advanceTimersByTime(live.PING_INTERVAL_MS + live.PONG_TIMEOUT_MS - 1);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(first.closed).toBe(true);
    expect(live.getLiveStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(live.RETRY_BASE_MS);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stays connected in a hidden tab whose repeating timers fire only once a minute', () => {
    const throttled = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void) => throttled(fn, 60_000)) as typeof setInterval);
    live.subscribeToChanges(() => {});
    const first = latest();
    first.open();
    for (let minute = 0; minute < 10; minute++) {
      vi.advanceTimersByTime(60_000); // the held-back ping goes out...
      first.emit(JSON.stringify({ type: 'pong' })); // ...and is answered at once
    }
    expect(first.sent).toHaveLength(10);
    expect(first.closed).toBe(false);
    expect(live.getLiveStatus()).toBe('connected');
  });
});
