import type { ChangeEvent } from '@flagship/shared';

type Listener = (event: ChangeEvent) => void;

/** In-process pub/sub feeding the SSE endpoint. */
export class ChangeNotifier {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after a successful commit; a failing listener must not turn a saved change into an error response. */
  publish(event: ChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Change listener failed', error);
      }
    }
  }
}
