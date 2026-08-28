import type {
  HelperHello,
  HelperHintNext,
  HelperHintSubmit,
  HelperMessageDone,
  HelperRenderClaims,
  HelperTestCallbackDone,
  HelperTimerGet,
  HelperTrigger,
  HelperVideoEnded,
  HelperVideoError,
  HintError,
  HintShow,
  JsonValue,
  PlayerHintCode,
  PlayerMessage,
  PlayerSubtitle,
  PlayerVideoPlay,
  PlayerVideoStop,
  SessionMode,
} from '@roomkit/shared';
import { Emitter } from './emitter.js';
import { HELPER_VERSION } from './version.js';

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
/** Event runs can be long (waits, videos) — the trigger wait is generous. */
const TRIGGER_TIMEOUT_MS = 600_000;
const HELLO_RETRY_MS = 800;
const HELLO_RETRY_MAX = 25;

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

/**
 * Named handler for one message asset. May return a promise: when the command
 * was sent with waitUntilEnd, the server sequence waits until it settles (a
 * rejection fails the command; the sequence still continues).
 */
export type MessageHandler = (
  payload: Record<string, JsonValue>,
  envelope: PlayerMessage,
) => void | Promise<unknown>;

/** Parameterless callback invokable from the player's debug window (test only). */
export type TestCallback = () => void | Promise<void>;

export interface RoomKitHelperOptions {
  /** Test seam; defaults to `window.parent`. */
  parentWindow?: Pick<Window, 'postMessage'>;
  /** Test seam; defaults to `window`. */
  selfWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /**
   * Disable the context menu and text selection document-wide, matching the
   * player's kiosk defaults (inputs/textareas stay selectable). Default true;
   * set false while developing the site in a normal browser. In test sessions
   * the player reports its mode and the context menu stays available so
   * devtools can be opened.
   */
  lockdown?: boolean;
  /**
   * Slots this site renders itself instead of the player. While claimed the
   * player suppresses its own overlay and forwards the data as 'subtitle' /
   * 'hintCode' / 'videoPlay' events. Claiming `video` means the site plays the
   * media itself (audio included) and MUST call videoEnded()/videoError() —
   * sequences waiting on the video's end block on that report.
   */
  renders?: Partial<HelperRenderClaims>;
  /**
   * Message handlers keyed by message asset name, registered at construction.
   * The names are reported to the player in the hello, so the debug window
   * can list (and send) exactly the messages this page understands. Prefer
   * this over `on('message')`, which cannot be enumerated.
   */
  messages?: Record<string, MessageHandler>;
  /**
   * Named parameterless callbacks for testing, reported to the player like
   * `messages` and invokable from the debug window (test sessions only).
   */
  testCallbacks?: Record<string, TestCallback>;
}

export interface TriggerAndWaitOptions {
  /** Reply timeout; the promise rejects when it elapses. Default 600000ms. */
  timeoutMs?: number;
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
  /**
   * Payload of a "send message to device" command, relayed by the player.
   * Listeners may return a promise: when the command was sent with
   * waitUntilEnd, the server sequence waits until every listener's promise
   * settles (a rejection fails the command; the sequence still continues).
   * @deprecated Register named handlers via the `messages` constructor option
   * instead — they are reported to the player for debugging. This catch-all
   * listener keeps working alongside them.
   */
  message: [Record<string, JsonValue>, PlayerMessage];
  /** A hint step to render (reply to submitHint/requestHintStep, or a push). */
  hint: [HintShow];
  hintError: [HintError];
  /** Claimed subtitle slot: the current line (html/css/params), null = clear. */
  subtitle: [PlayerSubtitle['subtitle']];
  /** Claimed hintCode slot: the current entry code (code/css/params), null = hide. */
  hintCode: [PlayerHintCode['hintCode']];
  /** Claimed video slot: play this media; report videoEnded/videoError when done. */
  videoPlay: [Omit<PlayerVideoPlay, 'source' | 'type'>];
  /** Claimed video slot: stop the playback with this commandId. */
  videoStop: [Omit<PlayerVideoStop, 'source' | 'type'>];
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
  // Test sessions keep the context menu so devtools stay reachable.
  private readonly onContextMenu = (event: Event) => {
    if (this.mode !== 'test') event.preventDefault();
  };
  /** Player-reported session mode; production (locked down) until told. */
  private mode: SessionMode = 'production';
  /** Named message handlers from the `messages` option. */
  private readonly messages: Record<string, MessageHandler>;
  /** Named test callbacks from the `testCallbacks` option. */
  private readonly testCallbacks: Record<string, TestCallback>;
  /** blob: URL minted for the current delegated video; revoked on the next play/stop/destroy. */
  private videoUrl: string | null = null;
  /** Injected lockdown stylesheet, kept for removal in destroy(). */
  private lockdownStyle: HTMLStyleElement | null = null;
  /** hello retry timer; stopped by the first player message (the ack). */
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  /** In-flight timer:get requests, keyed by requestId. */
  private readonly pendingTimers = new Map<
    string,
    { resolve: (remainingMs: number | null) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  /** In-flight awaited triggers, keyed by requestId. */
  private readonly pendingTriggers = new Map<
    string,
    {
      resolve: () => void;
      reject: (err: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(options: RoomKitHelperOptions = {}) {
    this.parent = options.parentWindow ?? window.parent;
    this.self = options.selfWindow ?? window;
    this.messages = options.messages ?? {};
    this.testCallbacks = options.testCallbacks ?? {};
    this.self.addEventListener('message', this.onMessage as EventListener);
    if (options.lockdown !== false) this.lockdown();
    // Tells the player this frame is ready (and which slots it renders); the
    // player flushes buffered messages on it.
    const hello: HelperHello = {
      source: HELPER_SOURCE,
      type: 'hello',
      renders: {
        subtitle: options.renders?.subtitle ?? false,
        hintCode: options.renders?.hintCode ?? false,
        video: options.renders?.video ?? false,
      },
      version: HELPER_VERSION,
      messages: Object.keys(this.messages),
      testCallbacks: Object.keys(this.testCallbacks),
    };
    this.post(hello);
    // The player's bridge may not be listening yet (created after this frame
    // ran) or may have reset on a load event that raced this hello — repeat
    // until any player message proves the bridge heard us (it replies 'mode'
    // to every hello). Bounded so a page opened outside the player goes quiet.
    let attempts = 0;
    this.helloTimer = setInterval(() => {
      if (++attempts >= HELLO_RETRY_MAX) this.stopHelloRetry();
      this.post(hello);
    }, HELLO_RETRY_MS);
  }

  private stopHelloRetry(): void {
    if (this.helloTimer !== null) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
  }

  /** Session mode as reported by the player ('production' until told otherwise). */
  get sessionMode(): SessionMode {
    return this.mode;
  }

  /**
   * The iframe is its own document, so the player's kiosk defaults do not
   * reach it — re-apply them here: no context menu, no text selection
   * (inputs/textareas excepted so puzzle forms keep working). In test
   * sessions the context menu stays available (right-click → devtools).
   */
  private lockdown(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('contextmenu', this.onContextMenu, true);
    const style = document.createElement('style');
    style.textContent =
      'body{user-select:none;-webkit-user-select:none}' +
      'input,textarea{user-select:text;-webkit-user-select:text}';
    (document.head ?? document.documentElement).appendChild(style);
    this.lockdownStyle = style;
  }

  /** Report a game event through the player's device connection. */
  trigger(event: string, payload?: JsonValue): void {
    const msg: HelperTrigger = { source: HELPER_SOURCE, type: 'trigger', event };
    if (payload !== undefined) msg.payload = payload;
    this.post(msg);
  }

  /**
   * Report a game event and resolve once the server has completely finished
   * every event run it started (the player relays the server's trigger ack).
   * A command failing inside a run does not reject — the run still finishes.
   * Rejects when the player reports the wait failed (device offline, server
   * predating trigger acks) or when no reply arrives within `timeoutMs`
   * (default 600000ms — e.g. the page runs outside the player).
   */
  triggerAndWait(
    event: string,
    payload?: JsonValue,
    options: TriggerAndWaitOptions = {},
  ): Promise<void> {
    const id = requestId();
    const msg: HelperTrigger = {
      source: HELPER_SOURCE,
      type: 'trigger',
      event,
      requestId: id,
    };
    if (payload !== undefined) msg.payload = payload;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTriggers.delete(id);
        reject(new Error('trigger wait timed out'));
      }, options.timeoutMs ?? TRIGGER_TIMEOUT_MS);
      this.pendingTriggers.set(id, { resolve, reject, timeout });
      this.post(msg);
    });
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

  /** A delegated video ('videoPlay') finished playing; acks the play command. */
  videoEnded(commandId: string): void {
    this.post({
      source: HELPER_SOURCE,
      type: 'video:ended',
      commandId,
    } satisfies HelperVideoEnded);
  }

  /** A delegated video could not be played; the play command fails over. */
  videoError(commandId: string): void {
    this.post({
      source: HELPER_SOURCE,
      type: 'video:error',
      commandId,
    } satisfies HelperVideoError);
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

  private revokeVideoUrl(): void {
    if (this.videoUrl !== null) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }
  }

  /** Unregisters the message listener; the instance is dead afterwards. */
  destroy(): void {
    this.stopHelloRetry();
    this.revokeVideoUrl();
    this.self.removeEventListener('message', this.onMessage as EventListener);
    if (typeof document !== 'undefined') {
      document.removeEventListener('contextmenu', this.onContextMenu, true);
    }
    this.lockdownStyle?.remove();
    this.lockdownStyle = null;
    for (const pending of this.pendingTimers.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingTimers.clear();
    // Unlike timers (null is a valid answer), a destroyed wait cannot claim
    // the runs finished — reject so awaiters don't proceed on a lie.
    for (const pending of this.pendingTriggers.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('helper destroyed'));
    }
    this.pendingTriggers.clear();
  }

  private post(
    message:
      | HelperHello
      | HelperTrigger
      | HelperHintSubmit
      | HelperHintNext
      | HelperTimerGet
      | HelperVideoEnded
      | HelperVideoError
      | HelperMessageDone
      | HelperTestCallbackDone,
  ): void {
    // '*': the player's (tauri) origin is unknowable from inside the iframe;
    // being embedded by the player is the trust anchor (see shared/helper.ts).
    this.parent.postMessage(message, '*');
  }

  private receive(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const msg = data as Record<string, unknown>;
    if (msg.source !== PLAYER_SOURCE) return;
    // Any player message means the bridge is up and has seen our hello.
    this.stopHelloRetry();
    switch (msg.type) {
      case 'message': {
        if (typeof msg.payload !== 'object' || msg.payload === null) return;
        const payload = msg.payload as Record<string, JsonValue>;
        const envelope = msg as unknown as PlayerMessage;
        const named =
          typeof envelope.messageName === 'string'
            ? this.messages[envelope.messageName]
            : undefined;
        // A commandId means the player awaits our handlers: collect handler
        // return values and report message:done once they all settle.
        if (typeof msg.commandId !== 'string') {
          if (named) {
            try {
              const result = named(payload, envelope);
              if (result instanceof Promise) result.catch(() => {});
            } catch {
              // Fire-and-forget delivery: a throwing handler has nowhere to report.
            }
          }
          this.emitter.emit('message', payload, envelope);
          return;
        }
        const commandId = msg.commandId;
        const results: unknown[] = [];
        if (named) {
          try {
            results.push(Promise.resolve(named(payload, envelope)));
          } catch (err) {
            results.push(Promise.reject(err));
          }
        }
        results.push(...this.emitter.emitCollect('message', payload, envelope));
        void Promise.allSettled(
          results.filter((r): r is Promise<unknown> => r instanceof Promise),
        ).then((settled) => {
          this.post({
            source: HELPER_SOURCE,
            type: 'message:done',
            commandId,
            ok: settled.every((s) => s.status === 'fulfilled'),
          } satisfies HelperMessageDone);
        });
        return;
      }
      case 'test:callback': {
        if (typeof msg.requestId !== 'string' || typeof msg.name !== 'string')
          return;
        const requestId = msg.requestId;
        const done = (ok: boolean) =>
          this.post({
            source: HELPER_SOURCE,
            type: 'test:callback:done',
            requestId,
            ok,
          } satisfies HelperTestCallbackDone);
        const callback = this.testCallbacks[msg.name];
        if (!callback) {
          done(false);
          return;
        }
        void Promise.resolve()
          .then(callback)
          .then(
            () => done(true),
            () => done(false),
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
      case 'trigger:result': {
        if (typeof msg.requestId !== 'string') return;
        const pending = this.pendingTriggers.get(msg.requestId);
        if (!pending) return;
        this.pendingTriggers.delete(msg.requestId);
        clearTimeout(pending.timeout);
        if (msg.ok === true) pending.resolve();
        else pending.reject(new Error('trigger failed'));
        return;
      }
      case 'subtitle': {
        // Null clears; otherwise an object with html/css/params.
        if (msg.subtitle !== null && (typeof msg.subtitle !== 'object' || msg.subtitle === undefined))
          return;
        this.emitter.emit('subtitle', (msg.subtitle ?? null) as PlayerSubtitle['subtitle']);
        return;
      }
      case 'hintCode': {
        if (msg.hintCode !== null && (typeof msg.hintCode !== 'object' || msg.hintCode === undefined))
          return;
        this.emitter.emit('hintCode', (msg.hintCode ?? null) as PlayerHintCode['hintCode']);
        return;
      }
      case 'video:play': {
        if (typeof msg.commandId !== 'string') return;
        this.revokeVideoUrl();
        const { blob, ...play } = msg as unknown as Omit<
          PlayerVideoPlay,
          'source' | 'type'
        >;
        // Cached media arrives as a Blob — this https page cannot load the
        // player's loopback media server (WebKit blocks mixed content even
        // from 127.0.0.1) — and becomes a same-origin blob: URL here, so
        // sites keep reading `url` and never see the handover.
        if (typeof Blob !== 'undefined' && blob instanceof Blob) {
          this.videoUrl = URL.createObjectURL(blob);
          this.emitter.emit('videoPlay', { ...play, url: this.videoUrl });
          return;
        }
        this.emitter.emit('videoPlay', play);
        return;
      }
      case 'video:stop': {
        if (typeof msg.commandId !== 'string') return;
        this.revokeVideoUrl();
        this.emitter.emit('videoStop', { commandId: msg.commandId });
        return;
      }
      case 'mode': {
        if (msg.mode !== 'test' && msg.mode !== 'production') return;
        this.mode = msg.mode;
        return;
      }
      default:
        return; // unknown player message: ignore (forward compatibility)
    }
  }
}
