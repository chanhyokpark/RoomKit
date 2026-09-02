/**
 * Transport-less entry: the hint controller/counter plus their types, without
 * `HintphoneConnection` (and thus without `@roomkit/client`/socket.io-client).
 * The helper wrapper packages bundle this — they run over the player bridge
 * and must not drag the socket transport into their dist.
 */
export {
  HintphoneController,
  IDLE_HINTPHONE_SNAPSHOT,
  type HintphoneSnapshot,
} from './controller.js';
export {
  EMPTY_HINT_COUNTER_STATS,
  HintphoneCounterCore,
  type HintCounterStats,
} from './counter.js';
export type {
  HintphoneConnectionEvents,
  HintphoneConnectionState,
  HintphoneEventSource,
} from './connection.js';
export type { HintError, HintErrorReason, HintShow } from '@roomkit/shared';
