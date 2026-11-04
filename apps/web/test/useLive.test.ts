import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Stand-in for the browser's EventSource that the test drives by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private handlers = new Map<string, ((e: { data: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (e: { data: string }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
  }
  emit(data: string, type = 'change') {
    this.handlers.get(type)?.forEach((h) => h({ data }));
  }
}

const latest = () => FakeEventSource.instances.at(-1)!;
let live: typeof import('../src/hooks/useLive');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules(); // fresh module state (one shared connection per app) for every test
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
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
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe('/api/events');

    latest().open();
    latest().emit(JSON.stringify({ entity: 'config', flagKey: 'new_search', environment: 'staging', auditId: 7 }));
    latest().emit('{not json');
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ entity: 'config', flagKey: 'new_search', environment: 'staging', auditId: 7 });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to unsubscribed listeners', () => {
    const listener = vi.fn();
    const unsubscribe = live.subscribeToChanges(listener);
    latest().open();
    unsubscribe();
    latest().emit(JSON.stringify({ entity: 'flag', flagKey: 'x', auditId: 1 }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('reconnects with exponential backoff up to the maximum delay, closing each failed connection', () => {
    live.subscribeToChanges(() => {});
    const delays = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
    for (const delay of delays) {
      const failed = latest();
      const count = FakeEventSource.instances.length;
      failed.fail();
      expect(failed.closed).toBe(true);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(count); // not yet
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances).toHaveLength(count + 1);
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
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances.filter((s) => !s.closed)).toHaveLength(1);
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

  it('treats a stream that stays silent (no heartbeat) as dead and reconnects', () => {
    live.subscribeToChanges(() => {});
    const first = latest();
    first.open();
    // Heartbeats keep it alive...
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(live.STALE_AFTER_MS - 1000);
      first.emit('{}', 'heartbeat');
    }
    expect(first.closed).toBe(false);
    expect(live.getLiveStatus()).toBe('connected');
    // ...silence does not.
    vi.advanceTimersByTime(live.STALE_AFTER_MS);
    expect(first.closed).toBe(true);
    expect(live.getLiveStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(live.RETRY_BASE_MS);
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
