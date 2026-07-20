import type {
  HelperHello,
  HelperHintNext,
  HelperHintSubmit,
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

export interface RoomKitHelperOptions {
  /** Test seam; defaults to `window.parent`. */
  parentWindow?: Pick<Window, 'postMessage'>;
  /** Test seam; defaults to `window`. */
  selfWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
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
  }

  private post(message: HelperHello | HelperTrigger | HelperHintSubmit | HelperHintNext): void {
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
      default:
        return; // unknown player message: ignore (forward compatibility)
    }
  }
}
