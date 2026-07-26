import { io, type Socket } from 'socket.io-client';
import {
  AckSchema,
  DEVICE_NAMESPACE,
  DeviceAssetManifestSchema,
  DeviceEvents,
  FATAL_CONNECT_ERRORS,
  HintErrorSchema,
  HintShowSchema,
  PlaybackProgressSchema,
  WelcomeSchema,
  WireCommandSchema,
  SessionStateSchema,
  type DeviceAssetManifest,
  type HintError,
  type HintShow,
  type JsonValue,
  type PlaybackProgress,
  type SessionState,
  type Welcome,
  type WireCommand,
  type WireHintCode,
  type WireMessage,
  type WireNavigate,
  type WirePlayCommand,
  type WireReset,
  type WireStop,
} from '@roomkit/shared';
import { Emitter } from './emitter.js';
import { defaultStorage, testCodeKey, type CodeStorage } from './storage.js';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type DoneFn = (status?: 'done' | 'failed') => void;

export interface RoomKitClientOptions {
  /** http(s) origin of the RoomKit server, e.g. `http://localhost:3000`. */
  serverUrl: string;
  /** Production device code, or an operator-issued test code. */
  deviceCode: string;
  /** Optional label sent in the handshake (log niceness only). */
  deviceName?: string;
  /**
   * Store a test code after a successful test attach and prefer it on the
   * next connect (auto-rejoin). Default true. The store is keyed per server
   * origin — disable this (or scope `storage`) when several devices share
   * one origin's localStorage, e.g. multiple player windows on one machine.
   */
  persistTestCode?: boolean;
  /** Storage override (defaults to localStorage; a no-op store in Node). */
  storage?: CodeStorage;
  /**
   * Keep retrying after fatal connect errors (invalid_code / session_ended)
   * instead of stopping with status 'error'. This lets a device boot before
   * its session or code exists (pre-boot) and rejoin after a session ends
   * with a re-issued code. Stored test codes are still forgotten on every
   * fatal error, so retries fall back to the configured deviceCode.
   * Default false.
   */
  retryOnFatalError?: boolean;
  /** Delay between fatal-error retries. Default 5000ms. */
  fatalRetryDelayMs?: number;
  /**
   * Log the connection lifecycle, inbound events/commands, and outbound
   * emits to the console (prefixed `[roomkit]`) so devtools show what the
   * client is doing. Invalid payloads are warned about regardless.
   * Default false.
   */
  debug?: boolean;
}

const FATAL_RETRY_DELAY_MS = 5000;
const RESYNC_TIMEOUT_MS = 10_000;
/** Event runs can be long (waits, videos) — the wait timeout is generous. */
const TRIGGER_WAIT_TIMEOUT_MS = 600_000;

export interface GetRemainingTimeOptions {
  /**
   * Fetch a fresh session-state snapshot from the server before computing,
   * instead of ticking from the last broadcast. Best effort: falls back to
   * the local value when not connected or on timeout. Default false.
   */
  resync?: boolean;
  /** Resync round-trip timeout. Default 10000ms. */
  timeoutMs?: number;
}

export interface RoomKitClientEvents extends Record<string, unknown[]> {
  welcome: [Welcome];
  /**
   * Playback is up to the consumer: call `done()` when playback finishes
   * (that sends the ack the server may be waiting on). Calling it twice is
   * a no-op. Looping BGM should call `done()` on playback start.
   *
   * Placeholder (fileless) commands carry `url: null` and a `durationMs`:
   * show a placeholder, simulate for that long, then call `done()` as usual
   * (looping placeholder BGM still acks on start).
   */
  play: [WirePlayCommand, DoneFn];
  stop: [WireStop];
  /**
   * Call `done()` once the website has actually changed (e.g. the iframe
   * finished loading) — the server sequence waits on this ack before running
   * the next command. A consumer that navigates the whole window away must
   * call `done()` before changing location (the socket unloads with the page).
   */
  navigate: [string, WireNavigate, DoneFn];
  /**
   * A sendMessage command's payload. Listeners may return a promise: when the
   * command was sent with waitUntilEnd (`cmd.awaitHandled`), the ack — and the
   * server sequence — waits until every listener's promise settles ('failed'
   * if any rejected). Without the flag the ack is sent before listeners run.
   */
  message: [Record<string, JsonValue>, WireMessage];
  reset: [WireReset];
  /**
   * Dialogue line sync relayed from the speaker (screen role), or the
   * go-ahead ending a line-cue hold (speaker role; see sendProgress).
   */
  progress: [PlaybackProgress];
  sessionState: [SessionState];
  status: [ConnectionStatus, string?];
  /**
   * A hint step to render — the reply to submitHint/requestHintStep, or an
   * operator push. Mirrored to every socket of the hint device.
   */
  hint: [HintShow];
  hintError: [HintError];
  /** Hint entry-code overlay: show (code set) or hide (code null). */
  hintCode: [WireHintCode];
}

const SEEN_COMMANDS_LIMIT = 200;

export class RoomKitClient {
  private readonly emitter = new Emitter<RoomKitClientEvents>();
  private readonly storage: CodeStorage;
  private readonly storageKey: string;
  private socket: Socket | null = null;
  private usedCode: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Delivery ids already dispatched (redeliveries are skipped). */
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  /** Completed commands (acked) — duplicates re-ack with the same status. */
  private readonly completed = new Map<string, 'done' | 'failed'>();

  private currentStatus: ConnectionStatus = 'idle';
  private lastSessionState: SessionState | null = null;
  /** Epoch ms when lastSessionState was received — base for local ticking. */
  private lastSessionStateAt = 0;

  constructor(private readonly options: RoomKitClientOptions) {
    this.storage = options.storage ?? defaultStorage();
    this.storageKey = testCodeKey(options.serverUrl);
  }

  /** Debug-only console logging; payload objects stay expandable in devtools. */
  private log(...args: unknown[]): void {
    if (this.options.debug) console.log('[roomkit]', ...args);
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  get sessionState(): SessionState | null {
    return this.lastSessionState;
  }

  connect(): void {
    if (this.socket) return;
    this.clearRetry();
    const stored =
      this.options.persistTestCode === false
        ? null
        : this.storage.getItem(this.storageKey);
    this.usedCode = stored ?? this.options.deviceCode;
    this.log('connecting', {
      serverUrl: this.options.serverUrl,
      deviceCode: this.usedCode,
      deviceName: this.options.deviceName,
      usingStoredTestCode: stored !== null,
    });
    this.setStatus('connecting');

    const socket = io(`${this.options.serverUrl}${DEVICE_NAMESPACE}`, {
      auth: { deviceCode: this.usedCode, deviceName: this.options.deviceName },
      transports: ['websocket', 'polling'],
    });
    this.socket = socket;

    socket.on('connect', () => this.setStatus('connected'));
    socket.on('disconnect', () => {
      if (this.currentStatus !== 'error') this.setStatus('disconnected');
    });
    socket.on('connect_error', (err: Error) => {
      if ((FATAL_CONNECT_ERRORS as readonly string[]).includes(err.message)) {
        this.forgetTestCode();
        socket.disconnect();
        this.socket = null;
        if (this.options.retryOnFatalError) {
          // The code may simply not exist *yet* — poll with a fresh socket
          // (and the configured code, now that any stored one is forgotten).
          this.log(
            'fatal connect error, retrying in',
            this.options.fatalRetryDelayMs ?? FATAL_RETRY_DELAY_MS,
            'ms:',
            err.message,
          );
          this.setStatus('connecting', err.message);
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect();
          }, this.options.fatalRetryDelayMs ?? FATAL_RETRY_DELAY_MS);
        } else {
          this.setStatus('error', err.message);
        }
      } else {
        this.setStatus('connecting', err.message);
      }
    });

    socket.on(DeviceEvents.welcome, (payload: unknown) => {
      const parsed = WelcomeSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[roomkit] invalid welcome dropped', payload, parsed.error);
        return;
      }
      const welcome = parsed.data;
      this.log('welcome', welcome);
      this.rememberSessionState(welcome.session);
      // A test-mode welcome means the code we used is a test code — persist
      // it for auto-rejoin (codes carry no reserved prefix).
      if (
        welcome.session.mode === 'test' &&
        this.options.persistTestCode !== false &&
        this.usedCode
      ) {
        this.storage.setItem(this.storageKey, this.usedCode);
      }
      this.emitter.emit('welcome', welcome);
      this.emitter.emit('sessionState', welcome.session);
    });

    socket.on(DeviceEvents.sessionState, (payload: unknown) => {
      const parsed = SessionStateSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[roomkit] invalid session state dropped', payload, parsed.error);
        return;
      }
      this.log('session state', parsed.data);
      this.rememberSessionState(parsed.data);
      if (parsed.data.state === 'ended') this.forgetTestCode();
      this.emitter.emit('sessionState', parsed.data);
    });

    socket.on(DeviceEvents.command, (payload: unknown) => this.handleCommand(payload));

    socket.on(DeviceEvents.progress, (payload: unknown) => {
      const parsed = PlaybackProgressSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[roomkit] invalid progress dropped', payload, parsed.error);
        return;
      }
      this.log('progress', parsed.data);
      this.emitter.emit('progress', parsed.data);
    });

    socket.on(DeviceEvents.hintShow, (payload: unknown) => {
      const parsed = HintShowSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[roomkit] invalid hint dropped', payload, parsed.error);
        return;
      }
      this.log('hint', parsed.data);
      this.emitter.emit('hint', parsed.data);
    });

    socket.on(DeviceEvents.hintError, (payload: unknown) => {
      const parsed = HintErrorSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[roomkit] invalid hint error dropped', payload, parsed.error);
        return;
      }
      this.log('hint error', parsed.data);
      this.emitter.emit('hintError', parsed.data);
    });
  }

  disconnect(): void {
    this.clearRetry();
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('idle');
  }

  /** Report a game event (sensor, button, …). */
  trigger(event: string, payload?: JsonValue): void {
    this.log('trigger', event, payload);
    this.socket?.emit(DeviceEvents.trigger, { event, payload });
  }

  /**
   * Report a game event and resolve once the server has completely finished
   * every event run it started (immediately when nothing listens). A command
   * failing inside a run does not reject — the run still finishes. Rejects
   * when not connected, or when no ack arrives within `timeoutMs` (runs
   * longer than that — or a server predating trigger acks — reject even
   * though the runs themselves continue). Default 600000ms.
   */
  triggerAndWait(
    event: string,
    payload?: JsonValue,
    timeoutMs = TRIGGER_WAIT_TIMEOUT_MS,
  ): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('not connected'));
    this.log('trigger (awaited)', event, payload);
    return new Promise((resolve, reject) => {
      socket
        .timeout(timeoutMs)
        .emit(DeviceEvents.trigger, { event, payload }, (err: Error | null) => {
          if (err) return reject(new Error('trigger wait timed out'));
          this.log('trigger finished', event);
          resolve();
        });
    });
  }

  /**
   * Speaker-role dialogue: report that `lineIndex` started playing so the
   * server can relay subtitle sync to the screen device. With `waiting: true`
   * the speaker instead reports that it is holding before `lineIndex` (a
   * line-cue gap); the server answers with a plain 'progress' event for the
   * same commandId/lineIndex as the go-ahead.
   */
  sendProgress(commandId: string, lineIndex: number, waiting = false): void {
    this.log('send progress', { commandId, lineIndex, waiting });
    this.socket?.emit(DeviceEvents.progress, { commandId, lineIndex, waiting });
  }

  /**
   * Hint-device only: submit a player-entered hint code. The result arrives
   * as a 'hint' (or 'hintError') event.
   */
  submitHint(code: string): void {
    this.log('submit hint', code);
    this.socket?.emit(DeviceEvents.hintSubmit, { code });
  }

  /** Stateless step advance: request the exact 0-based step to show. */
  requestHintStep(hintId: string, step: number): void {
    this.log('request hint step', { hintId, step });
    this.socket?.emit(DeviceEvents.hintNext, { hintId, step });
  }

  /**
   * Fetch the media manifest this device should pre-cache. URLs are presigned
   * (~6h — see urlExpiresAt); re-call to refresh. Rejects when not connected,
   * on timeout, or when the socket has no theme (e.g. mid-reattach).
   */
  fetchAssetManifest(timeoutMs = 10_000): Promise<DeviceAssetManifest> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('not connected'));
    return new Promise((resolve, reject) => {
      socket
        .timeout(timeoutMs)
        .emit(
          DeviceEvents.assetManifest,
          {},
          (err: Error | null, ack: unknown) => {
            if (err) return reject(new Error('manifest request timed out'));
            const parsed = DeviceAssetManifestSchema.safeParse(ack);
            if (!parsed.success) {
              return reject(new Error('no manifest available'));
            }
            this.log('asset manifest', parsed.data);
            resolve(parsed.data);
          },
        );
    });
  }

  /**
   * Remaining timer milliseconds: ticks down locally while the timer is
   * running, frozen while paused, 0 when expired. Null when the theme has no
   * timer or no session state has been received yet. With `resync: true` the
   * server is asked for a fresh snapshot first (see GetRemainingTimeOptions).
   */
  async getRemainingTime(
    options: GetRemainingTimeOptions = {},
  ): Promise<number | null> {
    if (options.resync) {
      await this.resyncSessionState(options.timeoutMs ?? RESYNC_TIMEOUT_MS);
    }
    const state = this.lastSessionState;
    if (!state || state.timerState === null || state.timerRemainingMs === null) {
      return null;
    }
    if (state.timerState !== 'running') return state.timerRemainingMs;
    const elapsed = Date.now() - this.lastSessionStateAt;
    return Math.max(0, state.timerRemainingMs - elapsed);
  }

  /** Best-effort snapshot refresh; keeps the current one on any failure. */
  private resyncSessionState(timeoutMs: number): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) return Promise.resolve();
    return new Promise((resolve) => {
      socket
        .timeout(timeoutMs)
        .emit(DeviceEvents.sessionSync, {}, (err: Error | null, ack: unknown) => {
          if (!err) {
            const parsed = SessionStateSchema.safeParse(ack);
            if (parsed.success) this.rememberSessionState(parsed.data);
          }
          resolve();
        });
    });
  }

  on<K extends keyof RoomKitClientEvents>(
    event: K,
    listener: (...args: RoomKitClientEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof RoomKitClientEvents>(
    event: K,
    listener: (...args: RoomKitClientEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  private handleCommand(payload: unknown): void {
    const parsed = WireCommandSchema.safeParse(payload);
    if (!parsed.success) {
      const id = (payload as { id?: unknown })?.id;
      console.warn('[roomkit] invalid command payload dropped', payload);
      if (typeof id === 'string') this.ack(id, 'failed');
      return;
    }
    const cmd = parsed.data;

    if (this.seen.has(cmd.id)) {
      // Redelivery. If we already finished it, repeat the ack; if it is
      // still in flight, the eventual done()/auto-ack covers it.
      const status = this.completed.get(cmd.id);
      this.log('command redelivered', cmd.type, cmd.id, status ?? 'still in flight');
      if (status) this.ack(cmd.id, status);
      return;
    }
    this.remember(cmd.id);
    this.log('command', cmd.type, cmd);

    switch (cmd.type) {
      case 'play': {
        let acked = false;
        const done: DoneFn = (status = 'done') => {
          if (acked) return;
          acked = true;
          this.ack(cmd.id, status);
        };
        this.emitter.emit('play', cmd as WirePlayCommand, done);
        break;
      }
      case 'stop':
        this.ack(cmd.id, 'done');
        this.emitter.emit('stop', cmd as WireStop);
        break;
      case 'navigate': {
        let acked = false;
        const done: DoneFn = (status = 'done') => {
          if (acked) return;
          acked = true;
          this.ack(cmd.id, status);
        };
        this.emitter.emit(
          'navigate',
          (cmd as WireNavigate).url,
          cmd as WireNavigate,
          done,
        );
        break;
      }
      case 'message': {
        const msg = cmd as WireMessage;
        if (!msg.awaitHandled) {
          this.ack(cmd.id, 'done');
          this.emitter.emit('message', msg.payload, msg);
          break;
        }
        // Awaited message: the ack waits until every listener's returned
        // promise settles; any rejection acks 'failed'. Sync listeners (and
        // no listeners at all) settle immediately.
        const results = this.emitter.emitCollect('message', msg.payload, msg);
        void Promise.allSettled(
          results.filter((r): r is Promise<unknown> => r instanceof Promise),
        ).then((settled) => {
          const failed = settled.some((s) => s.status === 'rejected');
          this.ack(cmd.id, failed ? 'failed' : 'done');
        });
        break;
      }
      case 'reset':
        this.ack(cmd.id, 'done');
        this.emitter.emit('reset', cmd as WireReset);
        break;
      case 'hintCode':
        this.ack(cmd.id, 'done');
        this.emitter.emit('hintCode', cmd as WireHintCode);
        break;
    }
  }

  private ack(commandId: string, status: 'done' | 'failed'): void {
    this.log('ack', status, commandId);
    this.completed.set(commandId, status);
    if (this.completed.size > SEEN_COMMANDS_LIMIT) {
      const oldest = this.completed.keys().next().value;
      if (oldest !== undefined) this.completed.delete(oldest);
    }
    const payload = AckSchema.safeParse({ commandId, status });
    if (payload.success) this.socket?.emit(DeviceEvents.ack, payload.data);
  }

  private remember(commandId: string): void {
    this.seen.add(commandId);
    this.seenOrder.push(commandId);
    if (this.seenOrder.length > SEEN_COMMANDS_LIMIT) {
      const oldest = this.seenOrder.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private rememberSessionState(state: SessionState): void {
    this.lastSessionState = state;
    this.lastSessionStateAt = Date.now();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private forgetTestCode(): void {
    if (this.options.persistTestCode === false) return;
    this.storage.removeItem(this.storageKey);
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    if (status !== this.currentStatus || detail !== undefined) {
      this.log('status', status, detail ?? '');
    }
    this.currentStatus = status;
    this.emitter.emit('status', status, detail);
  }
}
