import type { ChangeEvent } from '@flagship/shared';

/** Delivers change events to live clients after a commit. Services call it through `publishChange`, which catches failures. */
export interface ChangePublisher {
  publish(event: ChangeEvent): Promise<void>;
}

type Listener = (event: ChangeEvent) => void;

/** In-process pub/sub feeding the local WebSocket endpoint (`live.ts`). */
export class ChangeNotifier implements ChangePublisher {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(event: ChangeEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Change listener failed', error);
      }
    }
  }
}
