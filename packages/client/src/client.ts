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
}

const FATAL_RETRY_DELAY_MS = 5000;

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
  message: [Record<string, JsonValue>, WireMessage];
  reset: [WireReset];
  /** Dialogue line sync relayed from the speaker (screen role only). */
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

  constructor(private readonly options: RoomKitClientOptions) {
    this.storage = options.storage ?? defaultStorage();
    this.storageKey = testCodeKey(options.serverUrl);
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
      if (!parsed.success) return;
      const welcome = parsed.data;
      this.lastSessionState = welcome.session;
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
      if (!parsed.success) return;
      this.lastSessionState = parsed.data;
      if (parsed.data.state === 'ended') this.forgetTestCode();
      this.emitter.emit('sessionState', parsed.data);
    });

    socket.on(DeviceEvents.command, (payload: unknown) => this.handleCommand(payload));

    socket.on(DeviceEvents.progress, (payload: unknown) => {
      const parsed = PlaybackProgressSchema.safeParse(payload);
      if (parsed.success) this.emitter.emit('progress', parsed.data);
    });

    socket.on(DeviceEvents.hintShow, (payload: unknown) => {
      const parsed = HintShowSchema.safeParse(payload);
      if (parsed.success) this.emitter.emit('hint', parsed.data);
    });

    socket.on(DeviceEvents.hintError, (payload: unknown) => {
      const parsed = HintErrorSchema.safeParse(payload);
      if (parsed.success) this.emitter.emit('hintError', parsed.data);
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
    this.socket?.emit(DeviceEvents.trigger, { event, payload });
  }

  /**
   * Speaker-role dialogue: report that `lineIndex` started playing so the
   * server can relay subtitle sync to the screen device.
   */
  sendProgress(commandId: string, lineIndex: number): void {
    this.socket?.emit(DeviceEvents.progress, { commandId, lineIndex });
  }

  /**
   * Hint-device only: submit a player-entered hint code. The result arrives
   * as a 'hint' (or 'hintError') event.
   */
  submitHint(code: string): void {
    this.socket?.emit(DeviceEvents.hintSubmit, { code });
  }

  /** Stateless step advance: request the exact 0-based step to show. */
  requestHintStep(hintId: string, step: number): void {
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
            resolve(parsed.data);
          },
        );
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
      if (status) this.ack(cmd.id, status);
      return;
    }
    this.remember(cmd.id);

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
      case 'message':
        this.ack(cmd.id, 'done');
        this.emitter.emit('message', (cmd as WireMessage).payload, cmd as WireMessage);
        break;
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
    this.currentStatus = status;
    this.emitter.emit('status', status, detail);
  }
}
