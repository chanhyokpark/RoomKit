import { onDestroy } from 'svelte';
import type {
  GetRemainingTimeOptions,
  HapticsApi,
  HelperBridgeState,
  HintCodeState,
  HintCounterStats,
  HintError,
  HintShow,
  ImpactFeedbackStyle,
  JsonValue,
  MessageHandler,
  NotificationFeedbackType,
  PlayerMessage,
  RoomKitApi,
  RoomKitHelper,
  RoomKitHelperEvents,
  RoomKitHintApi,
  SessionMode,
  SubtitleState,
  TriggerAndWaitOptions,
  VideoState,
} from './core.js';
import { isOutsidePlayer } from './core.js';
import { getRoomKitContext, type RoomKitContextState } from './context.svelte.js';

/** Hint navigation facade backed by the reactive context. */
class RoomKitHint implements RoomKitHintApi {
  constructor(private readonly ctx: RoomKitContextState) {}

  get data(): HintShow | null {
    return this.ctx.snapshot.hint;
  }
  get error(): HintError | null {
    return this.ctx.snapshot.error;
  }
  get pending(): boolean {
    return this.ctx.snapshot.pending;
  }
  get hasPrev(): boolean {
    return this.ctx.snapshot.hasPrev;
  }
  get hasNext(): boolean {
    return this.ctx.snapshot.hasNext;
  }
  get nextIsAnswer(): boolean {
    return this.ctx.snapshot.nextIsAnswer;
  }
  get counts(): HintCounterStats {
    return this.ctx.snapshot.hintCounts;
  }

  submit(code: string): void {
    this.ctx.core?.controller.submitCode(code);
  }
  prev(): void {
    this.ctx.core?.controller.prev();
  }
  next(): void {
    this.ctx.core?.controller.next();
  }
  showAnswer(): void {
    this.ctx.core?.controller.showAnswer();
  }
  dismiss(): void {
    this.ctx.core?.controller.dismiss();
  }
  resetCounts(): void {
    this.ctx.core?.resetHintCounts();
  }
}

/** Haptics facade over the (possibly not yet mounted) core. */
class RoomKitHaptics implements HapticsApi {
  constructor(private readonly ctx: RoomKitContextState) {}

  private get api(): HapticsApi | null {
    return this.ctx.core?.helper.haptics ?? null;
  }
  private notMounted(): Promise<never> {
    return Promise.reject(new Error('[roomkit] RoomKitSetup not mounted'));
  }

  vibrate(duration: number): Promise<void> {
    return this.api?.vibrate(duration) ?? this.notMounted();
  }
  impactFeedback(style: ImpactFeedbackStyle): Promise<void> {
    return this.api?.impactFeedback(style) ?? this.notMounted();
  }
  notificationFeedback(type: NotificationFeedbackType): Promise<void> {
    return this.api?.notificationFeedback(type) ?? this.notMounted();
  }
  selectionFeedback(): Promise<void> {
    return this.api?.selectionFeedback() ?? this.notMounted();
  }
}

/**
 * Per-component RoomKit view returned by {@link getRoomKit}. Value getters
 * are rune-backed — read them in templates, `$derived` or `$effect` to react
 * to updates (`rk.remainingMs` ticks on its own). Callback registrations
 * (`on`, `onMessage`, `onHintUpdate`, …) are scoped to this instance and
 * removed automatically when the creating component is destroyed (or by
 * calling {@link destroy} — other components' callbacks are unaffected).
 */
export class RoomKit implements RoomKitApi {
  readonly hint: RoomKitHintApi;
  /** The player device's haptics (mirrors `@tauri-apps/plugin-haptics`). */
  readonly haptics: HapticsApi;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly ctx: RoomKitContextState) {
    this.hint = new RoomKitHint(ctx);
    this.haptics = new RoomKitHaptics(ctx);
  }

  get bridge(): HelperBridgeState {
    return this.ctx.snapshot.bridge;
  }
  get sessionMode(): SessionMode {
    return this.ctx.snapshot.sessionMode;
  }
  /** Auto-updating remaining timer ms; null = no timer / not known yet. */
  get remainingMs(): number | null {
    return this.ctx.snapshot.remainingMs;
  }
  /** True when the page runs outside the player — render a warning. */
  get outsidePlayer(): boolean {
    return isOutsidePlayer(this.ctx.snapshot.bridge);
  }
  get subtitle(): SubtitleState {
    return this.ctx.snapshot.subtitle;
  }
  get hintCode(): HintCodeState {
    return this.ctx.snapshot.hintCode;
  }
  get video(): VideoState {
    return this.ctx.snapshot.video;
  }
  /** Raw helper escape hatch; null until setup has mounted. */
  get helper(): RoomKitHelper | null {
    return this.ctx.core?.helper ?? null;
  }

  trigger(event: string, payload?: JsonValue): void {
    this.ctx.core?.trigger(event, payload);
  }

  triggerAndWait(
    event: string,
    payload?: JsonValue,
    options?: TriggerAndWaitOptions,
  ): Promise<void> {
    const core = this.ctx.core;
    return core
      ? core.triggerAndWait(event, payload, options)
      : Promise.reject(new Error('[roomkit] RoomKitSetup not mounted'));
  }

  refreshTimer(options?: GetRemainingTimeOptions): Promise<number | null> {
    return this.ctx.core?.refreshTimer(options) ?? Promise.resolve(null);
  }

  videoEnded(commandId: string): void {
    this.ctx.core?.helper.videoEnded(commandId);
  }

  videoError(commandId: string): void {
    this.ctx.core?.helper.videoError(commandId);
  }

  /**
   * Subscribe to a raw helper event ('message', 'hint', 'hintError',
   * 'subtitle', 'hintCode', 'videoPlay', 'videoStop', 'bridge', 'mode').
   * Returns an unsubscribe function; also removed by {@link destroy}.
   */
  on<K extends keyof RoomKitHelperEvents>(
    event: K,
    listener: (...args: RoomKitHelperEvents[K]) => unknown,
  ): () => void {
    const relay = this.ctx.relay;
    relay.on(event, listener);
    const unsubscribe = () => void relay.off(event, listener);
    this.cleanups.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Handle player-relayed messages — the intuitive way to handle messages per
   * page instead of pre-registering everything at setup. Pass a name to
   * receive only that message asset (declare it in the setup's `messages`
   * option so the debug window lists it), or just a handler for every
   * message. A returned promise is awaited before an awaited (waitUntilEnd)
   * message command is acked.
   */
  onMessage(handler: MessageHandler): () => void;
  onMessage(name: string, handler: MessageHandler): () => void;
  onMessage(a: string | MessageHandler, b?: MessageHandler): () => void {
    const name = typeof a === 'string' ? a : undefined;
    const handler = (typeof a === 'string' ? b : a) as MessageHandler;
    return this.on('message', (payload, envelope: PlayerMessage) => {
      if (name !== undefined && envelope.messageName !== name) return;
      return handler(payload, envelope);
    });
  }

  /** A hint step/answer arrived (reply to submit/step request, or a push). */
  onHintUpdate(handler: (hint: HintShow) => void): () => void {
    return this.on('hint', handler);
  }

  /** A hint request failed. */
  onHintError(handler: (error: HintError) => void): () => void {
    return this.on('hintError', handler);
  }

  /**
   * Remove every callback registered through THIS instance (other components'
   * callbacks are unaffected). Called automatically when the component that
   * created the instance is destroyed; safe to call again manually.
   */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

/**
 * The RoomKit surface set up by an ancestor `<RoomKitSetup>`. Call during
 * component initialization:
 *
 * ```svelte
 * <script lang="ts">
 *   const rk = getRoomKit();
 *   rk.onMessage('announce', (payload) => { ... });
 * </script>
 * 남은 시간 {Math.ceil((rk.remainingMs ?? 0) / 1000)}초
 * <HintRenderer hint={rk.hint} />
 * ```
 *
 * Each call returns a fresh view whose callback registrations are cleaned up
 * with the calling component.
 */
export function getRoomKit(): RoomKit {
  const rk = new RoomKit(getRoomKitContext());
  try {
    onDestroy(() => rk.destroy());
  } catch {
    // Created outside component init — caller owns rk.destroy().
  }
  return rk;
}
