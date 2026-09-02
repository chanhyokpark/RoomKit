/**
 * @deprecated `@roomkit/hintphone-svelte` is superseded by
 * `@roomkit/helper-svelte`, which carries the same hint components plus the
 * full helper API (player-embedded sites only; use `@roomkit/client` for
 * standalone devices).
 */
export { default as HintphoneSetup } from './HintphoneSetup.svelte';
export { default as HintInput } from './HintInput.svelte';
export { default as HintRenderer } from './HintRenderer.svelte';
export {
  HintphoneContext,
  getHintphone,
} from './context.svelte.js';
export { HintCounter } from './counter.svelte.js';
export * from './core.js';
