import type {
  HelperHello,
  HelperHintNext,
  HelperHintSubmit,
  HelperTimerGet,
  HelperTrigger,
  HintError,
  HintShow,
  JsonValue,
  PlayerMessage,
} from '@roomkit/shared';
import { Emitter } from './emitter.js';

/*
 * The shared schemas define the envelopes (packages/shared/src/helper.ts),
 * but this bundle must stay a few KB — it is a <script> embed — so inbound
 * messages are checked structurally instead of with zod. The player side
 * validates with the zod schemas; tests here assert our hand-built envelopes
 * still parse against them.
 */
const HELPER_SOURCE = 'roomkit-helper';
const PLAYER_SOURCE = 'roomkit-player';
const TIMER_TIMEOUT_MS = 10_000;

/** uuid v4; falls back to Math.random on non-secure contexts (LAN http). */
function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface RoomKitHelperOptions {
  /** Test seam; defaults to `window.parent`. */
  parentWindow?: Pick<Window, 'postMessage'>;
  /** Test seam; defaults to `window`. */
  selfWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface GetRemainingTimeOptions {
  /**
   * Ask the player to resynchronize its snapshot with the server before
   * answering (best effort — the player falls back to its local value).
   * Default false.
   */
  resync?: boolean;
  /** Reply timeout; the promise rejects when it elapses. Default 10000ms. */
  timeoutMs?: number;
}

export interface RoomKitHelperEvents extends Record<string, unknown[]> {
  /** Payload of a "send message to device" command, relayed by the player. */
  message: [Record<string, JsonValue>, PlayerMessage];
  /** A hint step to render (reply to submitHint/requestHintStep, or a push). */
  hint: [HintShow];
  hintError: [HintError];
}

/**
 * Bridge for websites opened inside the RoomKit player's iframe. Talks to the
 * player via postMessage — no own server connection. Websites opened outside
 * the player are devices in their own right and use `@roomkit/client`.
 */
export class RoomKitHelper {
  private readonly emitter = new Emitter<RoomKitHelperEvents>();
  private readonly parent: Pick<Window, 'postMessage'>;
  private readonly self: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  private readonly onMessage = (event: MessageEvent) => this.receive(event.data);
  /** In-flight timer:get requests, keyed by requestId. */
  private readonly pendingTimers = new Map<
    string,
    { resolve: (remainingMs: number | null) => void; timeout: ReturnType<typeof setTimeout> }
  >();

  constructor(options: RoomKitHelperOptions = {}) {
    this.parent = options.parentWindow ?? window.parent;
    this.self = options.selfWindow ?? window;
    this.self.addEventListener('message', this.onMessage as EventListener);
    // Tells the player this frame is ready; it flushes buffered messages.
    this.post({ source: HELPER_SOURCE, type: 'hello' } satisfies HelperHello);
  }

  /** Report a game event through the player's device connection. */
  trigger(event: string, payload?: JsonValue): void {
    const msg: HelperTrigger = { source: HELPER_SOURCE, type: 'trigger', event };
    if (payload !== undefined) msg.payload = payload;
    this.post(msg);
  }

  /** Submit a player-entered hint code; the result arrives as 'hint'/'hintError'. */
  submitHint(code: string): void {
    this.post({
      source: HELPER_SOURCE,
      type: 'hint:submit',
      code,
    } satisfies HelperHintSubmit);
  }

  /** Stateless step advance: request the exact 0-based step to show. */
  requestHintStep(hintId: string, step: number): void {
    this.post({
      source: HELPER_SOURCE,
      type: 'hint:next',
      hintId,
      step,
    } satisfies HelperHintNext);
  }

  /**
   * Remaining timer milliseconds via the player: ticks down while running,
   * frozen while paused, 0 when expired. Null when the theme has no timer.
   * Rejects when the player does not answer within `timeoutMs` (e.g. the page
   * runs outside the player). Pass `resync: true` to have the player refresh
   * its snapshot from the server first.
   */
  getRemainingTime(options: GetRemainingTimeOptions = {}): Promise<number | null> {
    const id = requestId();
    const msg: HelperTimerGet = {
      source: HELPER_SOURCE,
      type: 'timer:get',
      requestId: id,
      resync: options.resync ?? false,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTimers.delete(id);
        reject(new Error('timer request timed out'));
      }, options.timeoutMs ?? TIMER_TIMEOUT_MS);
      this.pendingTimers.set(id, { resolve, timeout });
      this.post(msg);
    });
  }

  on<K extends keyof RoomKitHelperEvents>(
    event: K,
    listener: (...args: RoomKitHelperEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof RoomKitHelperEvents>(
    event: K,
    listener: (...args: RoomKitHelperEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /** Unregisters the message listener; the instance is dead afterwards. */
  destroy(): void {
    this.self.removeEventListener('message', this.onMessage as EventListener);
    for (const pending of this.pendingTimers.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingTimers.clear();
  }

  private post(
    message:
      | HelperHello
      | HelperTrigger
      | HelperHintSubmit
      | HelperHintNext
      | HelperTimerGet,
  ): void {
    // '*': the player's (tauri) origin is unknowable from inside the iframe;
    // being embedded by the player is the trust anchor (see shared/helper.ts).
    this.parent.postMessage(message, '*');
  }

  private receive(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const msg = data as Record<string, unknown>;
    if (msg.source !== PLAYER_SOURCE) return;
    switch (msg.type) {
      case 'message': {
        if (typeof msg.payload !== 'object' || msg.payload === null) return;
        this.emitter.emit(
          'message',
          msg.payload as Record<string, JsonValue>,
          msg as unknown as PlayerMessage,
        );
        return;
      }
      case 'hint:show': {
        if (typeof msg.hint !== 'object' || msg.hint === null) return;
        this.emitter.emit('hint', msg.hint as HintShow);
        return;
      }
      case 'hint:error': {
        if (typeof msg.error !== 'object' || msg.error === null) return;
        this.emitter.emit('hintError', msg.error as HintError);
        return;
      }
      case 'timer': {
        if (typeof msg.requestId !== 'string') return;
        const remainingMs =
          typeof msg.remainingMs === 'number' ? msg.remainingMs : null;
        const pending = this.pendingTimers.get(msg.requestId);
        if (!pending) return;
        this.pendingTimers.delete(msg.requestId);
        clearTimeout(pending.timeout);
        pending.resolve(remainingMs);
        return;
      }
      default:
        return; // unknown player message: ignore (forward compatibility)
    }
  }
}
