/**
 * @deprecated `@roomkit/hintphone-react` is superseded by
 * `@roomkit/helper-react`, which carries the same hint components plus the
 * full helper API (player-embedded sites only; use `@roomkit/client` for
 * standalone devices).
 */
export {
  HintphoneProvider,
  useHintphone,
  type HintphoneContextValue,
  type HintphoneProviderProps,
  type UseHintphoneValue,
} from './context.js';
export { HintInput, type HintInputProps } from './hint-input.js';
export { HintRenderer, type HintRendererProps } from './hint-renderer.js';
export { useHintCounter, type UseHintCounterValue } from './use-hint-counter.js';
export {
  HintphoneConnection,
  HintphoneController,
  HintphoneCounterCore,
  hintphoneCodeKey,
  type HintCounterStats,
  type HintError,
  type HintErrorReason,
  type HintphoneConnectionOptions,
  type HintphoneConnectionState,
  type HintphoneMode,
  type HintphoneSnapshot,
  type HintShow,
} from '@roomkit/hintphone-core';
