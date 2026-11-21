import { LIVE_PATH, LIVE_PING, type ChangeEvent, type LiveMessage } from '@flagship/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Receives each change event, or `null` after a reconnect: events may have been missed, so reload. */
type Listener = (event: ChangeEvent | null) => void;
/** `connecting`: first attempt; `reconnecting`: lost, retrying; `disconnected`: repeatedly failed, still retrying. */
export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;
/** After this many consecutive failed attempts the API counts as down; retries continue at the backoff delay. */
export const FAILURES_UNTIL_DISCONNECTED = 3;
/** The server answers every ping. Pings also keep the connection under AWS API Gateway's 10-minute idle timeout. */
export const PING_INTERVAL_MS = 20_000;
/**
 * No message within this long after a ping means the connection is dead (e.g. a proxy whose upstream died).
 * The deadline starts at the ping, not at the last message: browsers fire a hidden tab's repeating timers only
 * once a minute, which would otherwise outlast a fixed silence limit and reconnect a healthy connection.
 */
export const PONG_TIMEOUT_MS = 10_000;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let missedEvents = false;
let status: LiveStatus = 'connecting';

function setStatus(next: LiveStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

const liveUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${LIVE_PATH}`;

function connect() {
  retryTimer = null;
  const ws = new WebSocket(liveUrl());
  socket = ws;
  let pongDeadline: ReturnType<typeof setTimeout> | undefined;
  let pinger: ReturnType<typeof setInterval> | undefined;

  const fail = () => {
    clearTimeout(pongDeadline);
    clearInterval(pinger);
    if (socket !== ws) return; // already handled
    ws.close();
    socket = null;
    failures += 1;
    missedEvents = true;
    setStatus(failures >= FAILURES_UNTIL_DISCONNECTED ? 'disconnected' : 'reconnecting');
    retryTimer = setTimeout(connect, Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
  };
  ws.onopen = () => {
    pinger = setInterval(() => {
      ws.send(LIVE_PING);
      pongDeadline ??= setTimeout(fail, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
    failures = 0;
    setStatus('connected');
    if (missedEvents) {
      missedEvents = false;
      listeners.forEach((l) => l(null));
    }
  };
  ws.onmessage = (e) => {
    clearTimeout(pongDeadline); // any message shows the connection works
    pongDeadline = undefined;
    let message: LiveMessage;
    try {
      message = JSON.parse(String(e.data)) as LiveMessage;
    } catch {
      return; // Ignore a malformed payload rather than break every listener.
    }
    if (message?.type === 'change') listeners.forEach((l) => l(message.event));
  };
  ws.onerror = fail;
  ws.onclose = fail;
}

/** One shared connection for the whole app, opened on first use and reconnected with exponential backoff. */
export function subscribeToChanges(listener: Listener): () => void {
  if (!socket && !retryTimer) connect();
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
 * Data stays visible during live reloads; it is cleared when `deps` change.
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
