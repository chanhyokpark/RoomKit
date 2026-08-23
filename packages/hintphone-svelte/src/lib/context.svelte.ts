import { getContext, setContext } from 'svelte';
import {
  IDLE_HINTPHONE_SNAPSHOT,
  type HintphoneConnection,
  type HintphoneController,
  type HintphoneSnapshot,
} from './core.js';

const KEY = Symbol.for('roomkit-hintphone');

/**
 * Reactive hintphone state shared through Svelte context. Created by
 * `<HintphoneSetup>`; read anywhere below it with {@link getHintphone}.
 */
export class HintphoneContext {
  /** Live snapshot (connection state, current hint, nav flags). */
  snapshot: HintphoneSnapshot = $state(IDLE_HINTPHONE_SNAPSHOT);
  /** Null until setup has mounted. */
  connection: HintphoneConnection | null = $state.raw(null);
  /** Null until setup has mounted. */
  controller: HintphoneController | null = $state.raw(null);
}

/** Component-internal: called by HintphoneSetup during init. */
export function createHintphoneContext(): HintphoneContext {
  const ctx = new HintphoneContext();
  setContext(KEY, ctx);
  return ctx;
}

/**
 * The hintphone state set up by an ancestor `<HintphoneSetup>`. Call during
 * component initialization.
 */
export function getHintphone(): HintphoneContext {
  const ctx = getContext<HintphoneContext | undefined>(KEY);
  if (!ctx) {
    throw new Error(
      '[roomkit-hintphone] getHintphone() requires an ancestor <HintphoneSetup>',
    );
  }
  return ctx;
}
