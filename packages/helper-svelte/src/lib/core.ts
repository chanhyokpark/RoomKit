/**
 * Self-contained core of the Svelte wrapper. In the published dist this file
 * is replaced by a tsup bundle (see tsup.config.ts) inlining @roomkit/helper
 * and the transport-less parts of @roomkit/hintphone-core — everything in
 * this package must import them through './core.js', never directly.
 */
import {
  RoomKitHelper,
  type GetRemainingTimeOptions,
  type HelperBridgeState,
  type HintError,
  type HintShow,
  type JsonValue,
  type PlayerHintCode,
  type PlayerSubtitle,
  type PlayerVideoPlay,
  type RoomKitHelperEvents,
  type RoomKitHelperOptions,
  type SessionMode,
  type TriggerAndWaitOptions,
} from '@roomkit/helper';
import {
  EMPTY_HINT_COUNTER_STATS,
  HintphoneController,
  HintphoneCounterCore,
  IDLE_HINTPHONE_SNAPSHOT,
  type HintCounterStats,
  type HintphoneConnectionEvents,
  type HintphoneConnectionState,
  type HintphoneEventSource,
  type HintphoneSnapshot,
} from '@roomkit/hintphone-core/standalone';


export * from '@roomkit/helper';
export {
  EMPTY_HINT_COUNTER_STATS,
  HintphoneController,
  HintphoneCounterCore,
  IDLE_HINTPHONE_SNAPSHOT,
  type HintCounterStats,
  type HintErrorReason,
  type HintphoneConnectionEvents,
  type HintphoneConnectionState,
  type HintphoneEventSource,
  type HintphoneSnapshot,
} from '@roomkit/hintphone-core/standalone';

/** How often the auto-updating timer polls the player. */
const TIMER_POLL_MS = 1000;

export interface RoomKitOptions extends RoomKitHelperOptions {
  /**
   * Poll interval for the auto-updating `remainingMs` value (the player
   * answers from its local snapshot, so polling is cheap). Default 1000;
   * false disables polling — use `refreshTimer()` manually.
   */
  timerPollMs?: number | false;
}

export type SubtitleState = PlayerSubtitle['subtitle'];
export type HintCodeState = PlayerHintCode['hintCode'];
export type VideoState = Omit<PlayerVideoPlay, 'source' | 'type'> | null;

/**
 * Immutable view of the helper state — the hintphone snapshot (hint
 * navigation) extended with the helper-only slots, the auto-updating timer,
 * and hint usage counts. A new object is produced on every change, so
 * framework bindings can use reference equality.
 */
export interface RoomKitSnapshot extends HintphoneSnapshot {
  /** postMessage bridge to the player; 'timeout' = opened outside the player. */
  bridge: HelperBridgeState;
  /** Player-reported session mode ('production' until told otherwise). */
  sessionMode: SessionMode;
  /** Remaining timer ms, auto-refreshed; null = no timer / not known yet. */
  remainingMs: number | null;
  /** Hint usage counts for the helper's lifetime. */
  hintCounts: HintCounterStats;
  /** Claimed subtitle slot: current line, null = clear. Idle when unclaimed. */
  subtitle: SubtitleState;
  /** Claimed hintCode slot: current entry code, null = hidden. */
  hintCode: HintCodeState;
  /** Claimed video slot: active delegated playback, null = none. */
  video: VideoState;
}

/** Snapshot served before a provider/setup has mounted (and during SSR). */
export const IDLE_ROOMKIT_SNAPSHOT: RoomKitSnapshot = {
  ...IDLE_HINTPHONE_SNAPSHOT,
  bridge: 'connecting',
  sessionMode: 'production',
  remainingMs: null,
  hintCounts: EMPTY_HINT_COUNTER_STATS,
  subtitle: null,
  hintCode: null,
  video: null,
};

/** True when the page runs outside the player (no bridge to talk to). */
export function isOutsidePlayer(bridge: HelperBridgeState): boolean {
  if (bridge === 'timeout') return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.parent === window;
  } catch {
    return false; // cross-origin parent — embedded in something
  }
}

/**
 * Hint navigation facade: the current step/answer plus the actions that move
 * it. Feed this to `HintInput`/`HintRenderer` (or omit their prop — they read
 * it from context).
 */
export interface RoomKitHintApi {
  /** The hint step (or answer) currently on screen; null = idle. */
  readonly data: HintShow | null;
  /** Last error; cleared by the next successful show or submit. */
  readonly error: HintError | null;
  /** A submit/step request is in flight. */
  readonly pending: boolean;
  /** prev() will do something. */
  readonly hasPrev: boolean;
  /** next() will do something (includes revealing the answer). */
  readonly hasNext: boolean;
  /** next() reveals the explicit answer rather than another step. */
  readonly nextIsAnswer: boolean;
  /** Usage counts (hints used, steps viewed, answers opened, wrong codes). */
  readonly counts: HintCounterStats;
  /** Submit an entered hint code. */
  submit(code: string): void;
  /** Show the previous step (from the answer: back to the last step). */
  prev(): void;
  /** Show the next step; on the last step this reveals the answer. */
  next(): void;
  /** Reveal the explicit answer directly (no-op without one). */
  showAnswer(): void;
  /** Clear the current hint and error (back to the idle input screen). */
  dismiss(): void;
  /** Zero the usage counts. */
  resetCounts(): void;
}

/**
 * The single per-component RoomKit surface: reactive values (bridge, session
 * mode, auto-updating timer, claimed slots), the hint facade, and actions.
 * Svelte adds instance-scoped callback registration on top; React registers
 * callbacks via the `useRoomKitEvent`/`useRoomKitMessage` hooks.
 */
export interface RoomKitApi {
  /** Bridge to the player; 'timeout' = opened outside the player. */
  readonly bridge: HelperBridgeState;
  /** Player-reported session mode. */
  readonly sessionMode: SessionMode;
  /** Remaining timer ms, auto-refreshed; null = no timer / not known yet. */
  readonly remainingMs: number | null;
  /** True when the page runs outside the player — render a warning. */
  readonly outsidePlayer: boolean;
  /** Claimed subtitle slot value (always null when unclaimed). */
  readonly subtitle: SubtitleState;
  /** Claimed hintCode slot value. */
  readonly hintCode: HintCodeState;
  /** Claimed video slot value. */
  readonly video: VideoState;
  /** Raw helper escape hatch; null until the provider/setup has mounted. */
  readonly helper: RoomKitHelper | null;
  /** Hint navigation facade. */
  readonly hint: RoomKitHintApi;
  /** Report a game event through the player's device connection. */
  trigger(event: string, payload?: JsonValue): void;
  /**
   * Report a game event and await every run it started. Not recommended —
   * prefer trigger() plus a server-sent message; see the helper docs.
   */
  triggerAndWait(
    event: string,
    payload?: JsonValue,
    options?: TriggerAndWaitOptions,
  ): Promise<void>;
  /** Refresh `remainingMs` now (resyncs with the server by default). */
  refreshTimer(options?: GetRemainingTimeOptions): Promise<number | null>;
  /** Report a delegated video finished (claimed video slot only). */
  videoEnded(commandId: string): void;
  /** Report a delegated video failed (claimed video slot only). */
  videoError(commandId: string): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance-erasing cast target
type AnyListener = (...args: any[]) => unknown;

/** Minimal typed event emitter (mirrors the helper's internal one). */
export class Emitter<Events extends Record<string, unknown[]>> {
  // Internally untyped; the public on/off/emit signatures carry the types.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private readonly listeners = new Map<keyof Events, Set<Function>>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: Events[K]) => void)(...args);
    }
  }

  /** Like emit, but collects return values; a throw becomes a rejected promise. */
  emitCollect<K extends keyof Events>(event: K, ...args: Events[K]): unknown[] {
    const results: unknown[] = [];
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        results.push((listener as (...a: Events[K]) => unknown)(...args));
      } catch (err) {
        results.push(Promise.reject(err));
      }
    }
    return results;
  }
}

/**
 * Stable relay of helper events. Owned by the provider/setup component and
 * kept across core re-creations, so callbacks registered by components before
 * the core mounts (or across StrictMode remounts) are never lost. 'message'
 * listener return values are combined into the awaited-message ack.
 */
export type RoomKitRelay = Emitter<RoomKitHelperEvents>;

const RELAY_EVENTS = [
  'message',
  'hint',
  'hintError',
  'subtitle',
  'hintCode',
  'videoPlay',
  'videoStop',
  'bridge',
  'mode',
] as const;

const BRIDGE_TO_STATE: Record<HelperBridgeState, HintphoneConnectionState> = {
  connecting: 'connecting',
  connected: 'connected',
  timeout: 'disconnected',
};

/**
 * Adapts a {@link RoomKitHelper} to the hintphone event-source contract so
 * the transport-agnostic HintphoneController/HintphoneCounterCore run on the
 * player bridge without `@roomkit/client` (no device codes, no socket).
 */
class HelperHintSource implements HintphoneEventSource {
  /** 'state' listeners wrapped to translate helper 'bridge' events. */
  private readonly stateListeners = new Map<AnyListener, (bridge: HelperBridgeState) => void>();

  constructor(private readonly helper: RoomKitHelper) {}

  get state(): HintphoneConnectionState {
    return BRIDGE_TO_STATE[this.helper.bridgeState];
  }

  submitHint(code: string): void {
    this.helper.submitHint(code);
  }

  requestHintStep(hintId: string, step: number): void {
    this.helper.requestHintStep(hintId, step);
  }

  on<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    if (event === 'state') {
      const wrapped = (bridge: HelperBridgeState) =>
        (listener as (state: HintphoneConnectionState) => void)(BRIDGE_TO_STATE[bridge]);
      this.stateListeners.set(listener as AnyListener, wrapped);
      this.helper.on('bridge', wrapped);
    } else {
      this.helper.on(event as 'hint' | 'hintError', listener as AnyListener);
    }
    return this;
  }

  off<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    if (event === 'state') {
      const wrapped = this.stateListeners.get(listener as AnyListener);
      if (wrapped) {
        this.stateListeners.delete(listener as AnyListener);
        this.helper.off('bridge', wrapped);
      }
    } else {
      this.helper.off(event as 'hint' | 'hintError', listener as AnyListener);
    }
    return this;
  }
}

/**
 * Owns one {@link RoomKitHelper} plus the hint controller/counter over it and
 * merges everything into a single subscribable {@link RoomKitSnapshot}.
 * Created by the framework provider/setup component; destroy() on unmount.
 */
export class RoomKitCore {
  readonly helper: RoomKitHelper;
  readonly controller: HintphoneController;
  /** Hintphone event-source view of the helper. */
  readonly source: HintphoneEventSource;
  private readonly counter: HintphoneCounterCore;
  private readonly subscribers = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private readonly timerPollMs: number | false;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private bridge: HelperBridgeState;
  private sessionMode: SessionMode;
  private remainingMs: number | null = null;
  private subtitle: SubtitleState = null;
  private hintCode: HintCodeState = null;
  private video: VideoState = null;
  private current: RoomKitSnapshot;

  private readonly onBridge = (bridge: HelperBridgeState): void => {
    this.bridge = bridge;
    if (bridge === 'connected') this.startTimerPolling();
    this.publish();
  };
  private readonly onMode = (mode: SessionMode): void => {
    this.sessionMode = mode;
    this.publish();
  };
  private readonly onSubtitle = (subtitle: SubtitleState): void => {
    this.subtitle = subtitle;
    this.publish();
  };
  private readonly onHintCode = (hintCode: HintCodeState): void => {
    this.hintCode = hintCode;
    this.publish();
  };
  private readonly onVideoPlay = (video: NonNullable<VideoState>): void => {
    this.video = video;
    this.publish();
  };
  private readonly onVideoStop = ({ commandId }: { commandId: string }): void => {
    if (this.video?.commandId !== commandId) return;
    this.video = null;
    this.publish();
  };

  constructor(options: RoomKitOptions = {}, relay?: RoomKitRelay) {
    const { timerPollMs, ...helperOptions } = options;
    this.timerPollMs = timerPollMs ?? TIMER_POLL_MS;
    this.helper = new RoomKitHelper(helperOptions);
    this.source = new HelperHintSource(this.helper);
    this.controller = new HintphoneController(this.source);
    this.counter = new HintphoneCounterCore(this.source);
    this.bridge = this.helper.bridgeState;
    this.sessionMode = this.helper.sessionMode;
    this.helper
      .on('bridge', this.onBridge)
      .on('mode', this.onMode)
      .on('subtitle', this.onSubtitle)
      .on('hintCode', this.onHintCode)
      .on('videoPlay', this.onVideoPlay)
      .on('videoStop', this.onVideoStop);
    this.cleanups.push(this.controller.subscribe(() => this.publish()));
    this.cleanups.push(this.counter.subscribe(() => this.publish()));
    if (relay) this.wireRelay(relay);
    if (this.bridge === 'connected') this.startTimerPolling();
    this.current = this.build();
  }

  /** Forward helper events into the (component-owned, stable) relay. */
  private wireRelay(relay: RoomKitRelay): void {
    for (const event of RELAY_EVENTS) {
      const forward =
        event === 'message'
          ? (...args: RoomKitHelperEvents['message']) => {
              // Awaited messages: combine listener promises so the helper's
              // message:done ack waits for (and reflects) relay listeners too.
              const results = relay.emitCollect('message', ...args);
              const promises = results.filter(
                (r): r is Promise<unknown> => r instanceof Promise,
              );
              if (promises.length === 0) return undefined;
              return Promise.allSettled(promises).then((settled) => {
                if (settled.some((s) => s.status === 'rejected')) {
                  throw new Error('message handler failed');
                }
              });
            }
          : (...args: unknown[]) =>
              relay.emit(event, ...(args as RoomKitHelperEvents[typeof event]));
      this.helper.on(event, forward as AnyListener);
      this.cleanups.push(() => void this.helper.off(event, forward as AnyListener));
    }
  }

  get snapshot(): RoomKitSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  trigger(event: string, payload?: JsonValue): void {
    this.helper.trigger(event, payload);
  }

  triggerAndWait(
    event: string,
    payload?: JsonValue,
    options?: TriggerAndWaitOptions,
  ): Promise<void> {
    return this.helper.triggerAndWait(event, payload, options);
  }

  /** Refresh `remainingMs` now; resyncs with the server unless told not to. */
  async refreshTimer(
    options: GetRemainingTimeOptions = { resync: true },
  ): Promise<number | null> {
    try {
      const value = await this.helper.getRemainingTime(options);
      if (value !== this.remainingMs) {
        this.remainingMs = value;
        this.publish();
      }
      return value;
    } catch {
      return this.remainingMs; // no answer (outside player / timeout)
    }
  }

  resetHintCounts(): void {
    this.counter.reset();
  }

  private startTimerPolling(): void {
    if (this.timerHandle !== null || this.timerPollMs === false) return;
    void this.refreshTimer({ resync: true });
    // The player answers from its local snapshot (already pause-aware), so a
    // cheap non-resync poll keeps remainingMs ticking.
    this.timerHandle = setInterval(
      () => void this.refreshTimer({ resync: false }),
      this.timerPollMs,
    );
  }

  destroy(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.controller.destroy();
    this.counter.destroy();
    this.helper
      .off('bridge', this.onBridge)
      .off('mode', this.onMode)
      .off('subtitle', this.onSubtitle)
      .off('hintCode', this.onHintCode)
      .off('videoPlay', this.onVideoPlay)
      .off('videoStop', this.onVideoStop);
    this.helper.destroy();
    this.subscribers.clear();
  }

  private build(): RoomKitSnapshot {
    return {
      ...this.controller.snapshot,
      bridge: this.bridge,
      sessionMode: this.sessionMode,
      remainingMs: this.remainingMs,
      hintCounts: this.counter.stats,
      subtitle: this.subtitle,
      hintCode: this.hintCode,
      video: this.video,
    };
  }

  private publish(): void {
    this.current = this.build();
    for (const listener of [...this.subscribers]) listener();
  }
}
