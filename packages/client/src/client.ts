import { io, type Socket } from 'socket.io-client';
import {
  AckSchema,
  DEVICE_NAMESPACE,
  DeviceEvents,
  FATAL_CONNECT_ERRORS,
  PlaybackProgressSchema,
  WelcomeSchema,
  WireCommandSchema,
  SessionStateSchema,
  type JsonValue,
  type PlaybackProgress,
  type SessionState,
  type Welcome,
  type WireCommand,
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
  /** Production device code, or a `tst_…` test code. */
  deviceCode: string;
  /** Optional label sent in the handshake (log niceness only). */
  deviceName?: string;
  /**
   * Store a test code after a successful test attach and prefer it on the
   * next connect (auto-rejoin). Default true.
   */
  persistTestCode?: boolean;
  /** Storage override (defaults to localStorage; a no-op store in Node). */
  storage?: CodeStorage;
}

export interface RoomKitClientEvents extends Record<string, unknown[]> {
  welcome: [Welcome];
  /**
   * Playback is up to the consumer: call `done()` when playback finishes
   * (that sends the ack the server may be waiting on). Calling it twice is
   * a no-op. Looping BGM should call `done()` on playback start.
   */
  play: [WirePlayCommand, DoneFn];
  stop: [WireStop];
  navigate: [string, WireNavigate];
  message: [Record<string, JsonValue>, WireMessage];
  reset: [WireReset];
  /** Dialogue line sync relayed from the speaker (screen role only). */
  progress: [PlaybackProgress];
  sessionState: [SessionState];
  status: [ConnectionStatus, string?];
}

const SEEN_COMMANDS_LIMIT = 200;

export class RoomKitClient {
  private readonly emitter = new Emitter<RoomKitClientEvents>();
  private readonly storage: CodeStorage;
  private readonly storageKey: string;
  private socket: Socket | null = null;
  private usedCode: string | null = null;

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
        this.setStatus('error', err.message);
      } else {
        this.setStatus('connecting', err.message);
      }
    });

    socket.on(DeviceEvents.welcome, (payload: unknown) => {
      const parsed = WelcomeSchema.safeParse(payload);
      if (!parsed.success) return;
      const welcome = parsed.data;
      this.lastSessionState = welcome.session;
      if (
        welcome.session.mode === 'test' &&
        this.options.persistTestCode !== false &&
        this.usedCode?.startsWith('tst_')
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
  }

  disconnect(): void {
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
      case 'navigate':
        this.ack(cmd.id, 'done');
        this.emitter.emit('navigate', (cmd as WireNavigate).url, cmd as WireNavigate);
        break;
      case 'message':
        this.ack(cmd.id, 'done');
        this.emitter.emit('message', (cmd as WireMessage).payload, cmd as WireMessage);
        break;
      case 'reset':
        this.ack(cmd.id, 'done');
        this.emitter.emit('reset', cmd as WireReset);
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

  private forgetTestCode(): void {
    if (this.options.persistTestCode === false) return;
    this.storage.removeItem(this.storageKey);
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.currentStatus = status;
    this.emitter.emit('status', status, detail);
  }
}
