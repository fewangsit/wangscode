// Minimal external store for React's useSyncExternalStore — the SDK's `query()` async loop and
// canUseTool callback both fire OUTSIDE React's render cycle (they're driven by repl.tsx's own
// `for await` loop, not by a component), so state changes need to reach the component tree via
// subscription rather than component-owned useState.
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get = (): T => this.state;

  set(next: T): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.state));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
