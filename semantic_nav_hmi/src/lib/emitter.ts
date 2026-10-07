/** Minimal typed event emitter for non-React data paths (high-rate streams). */

export type Listener<T> = (value: T) => void;

export class Signal<T = void> {
  private listeners = new Set<Listener<T>>();

  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(value: T): void {
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch (err) {
        console.error('[signal] listener failed', err);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
