import { getContext, setContext } from 'svelte';
import {
  Emitter,
  IDLE_ROOMKIT_SNAPSHOT,
  type RoomKitCore,
  type RoomKitRelay,
  type RoomKitSnapshot,
} from './core.js';

const KEY = Symbol.for('roomkit-helper');

/**
 * Package-internal reactive state shared through Svelte context. Created by
 * `<RoomKitSetup>`; components access it through the {@link RoomKit} view
 * returned by `getRoomKit()`.
 */
export class RoomKitContextState {
  /** Live snapshot (bridge/session mode/timer, current hint, claimed slots). */
  snapshot: RoomKitSnapshot = $state(IDLE_ROOMKIT_SNAPSHOT);
  /** Null until setup has mounted. */
  core: RoomKitCore | null = $state.raw(null);
  /** Stable across core re-creations — safe to subscribe before mount. */
  readonly relay: RoomKitRelay = new Emitter();
}

/** Component-internal: called by RoomKitSetup during init. */
export function createRoomKitContext(): RoomKitContextState {
  const ctx = new RoomKitContextState();
  setContext(KEY, ctx);
  return ctx;
}

/** Package-internal: the state set up by an ancestor `<RoomKitSetup>`. */
export function getRoomKitContext(): RoomKitContextState {
  const ctx = getContext<RoomKitContextState | undefined>(KEY);
  if (!ctx) {
    throw new Error('[roomkit-helper] getRoomKit() requires an ancestor <RoomKitSetup>');
  }
  return ctx;
}
