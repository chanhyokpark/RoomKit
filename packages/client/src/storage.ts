export type CodeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const NOOP_STORAGE: CodeStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** Browser localStorage when available; a no-op store in Node. */
export function defaultStorage(): CodeStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? NOOP_STORAGE;
  } catch {
    return NOOP_STORAGE;
  }
}

/**
 * One stored test code per server — assumes the storage holds exactly one
 * device. Consumers running several devices on one origin (shared
 * localStorage, e.g. the player's stage windows) must set
 * `persistTestCode: false` or scope `storage` per device, or every client
 * prefers the same stored code and attaches as the same device.
 */
export function testCodeKey(serverUrl: string): string {
  let origin = serverUrl;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    // keep the raw string; the key just has to be stable
  }
  return `roomkit.testCode:${origin}`;
}
