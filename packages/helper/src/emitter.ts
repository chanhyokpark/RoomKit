/** Minimal typed event emitter (browser + Node, no dependency). */
export class Emitter<Events extends Record<string, unknown[]>> {
  // Internally untyped; the public on/off/emit signatures carry the types.
  private readonly listeners = new Map<keyof Events, Set<Function>>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: Events[K]) => void)(...args);
    }
  }
}
