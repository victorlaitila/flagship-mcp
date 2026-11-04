import type { ChangeEvent } from '@flagship/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Receives each change event, or `null` after a reconnect: events may have been missed, so reload. */
type Listener = (event: ChangeEvent | null) => void;
/** `connecting`: first attempt; `reconnecting`: lost, retrying; `disconnected`: repeatedly failed, still retrying. */
export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;
/** After this many consecutive failed attempts the API counts as down; retries continue at the backoff delay. */
export const FAILURES_UNTIL_DISCONNECTED = 3;
/** The API sends a heartbeat every 5 s (`SSE_HEARTBEAT_MS`); this long without any event means the stream is dead. */
export const STALE_AFTER_MS = 15_000;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let missedEvents = false;
let status: LiveStatus = 'connecting';

function setStatus(next: LiveStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function connect() {
  retryTimer = null;
  const es = new EventSource('/api/events');
  source = es;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const fail = () => {
    clearTimeout(watchdog);
    if (source !== es) return; // already handled
    // We retry ourselves: the browser's built-in retry gives up for good on an HTTP error
    // (e.g. the dev proxy's 502 while the API restarts), and must not run alongside ours.
    es.close();
    source = null;
    failures += 1;
    missedEvents = true;
    setStatus(failures >= FAILURES_UNTIL_DISCONNECTED ? 'disconnected' : 'reconnecting');
    retryTimer = setTimeout(connect, Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
  };
  // A stream can stay open without delivering anything (e.g. behind a proxy whose upstream died).
  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(fail, STALE_AFTER_MS);
  };

  es.onopen = () => {
    alive();
    failures = 0;
    setStatus('connected');
    if (missedEvents) {
      missedEvents = false;
      listeners.forEach((l) => l(null));
    }
  };
  es.addEventListener('heartbeat', alive);
  es.addEventListener('change', (e) => {
    alive();
    let event: ChangeEvent;
    try {
      event = JSON.parse((e as MessageEvent<string>).data) as ChangeEvent;
    } catch {
      return; // Ignore a malformed payload rather than break every listener.
    }
    listeners.forEach((l) => l(event));
  });
  es.onerror = fail;
}

/** One shared connection for the whole app, opened on first use and reconnected with exponential backoff. */
export function subscribeToChanges(listener: Listener): () => void {
  if (!source && !retryTimer) connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLiveStatus = () => status;

export function subscribeToLiveStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export const useLiveStatus = () => useSyncExternalStore(subscribeToLiveStatus, getLiveStatus);

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data and reloads it whenever the backend reports a change, and after a reconnect.
 * Data stays visible during live (SSE) reloads; it is cleared when `deps` change.
 */
export function useLiveResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; error: Error | null; loading: boolean }>({ error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const requestId = useRef(0);

  const reload = useCallback(() => {
    const id = ++requestId.current;
    loadRef.current().then(
      (data) => id === requestId.current && setState({ data, error: null, loading: false }),
      (error: Error) => id === requestId.current && setState((s) => ({ ...s, error, loading: false })),
    );
  }, []);

  useEffect(() => {
    // New inputs (e.g. another user/environment): drop old data so it is never shown as current.
    setState({ error: null, loading: true });
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => subscribeToChanges(() => reload()), [reload]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}
