import type { ChangeEvent } from '@flagship/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

type Listener = (event: ChangeEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** One shared EventSource for the whole app; the browser reconnects automatically. */
export function subscribeToChanges(listener: Listener): () => void {
  if (!source) {
    source = new EventSource('/api/events');
    source.addEventListener('change', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as ChangeEvent;
      listeners.forEach((l) => l(event));
    });
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data and reloads it whenever the backend reports a configuration change.
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
