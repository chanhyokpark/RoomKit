import { RoomKitClient, type ConnectionStatus } from '@roomkit/client';
import { RoomKitHelper } from '@roomkit/helper';
import type { HintError, HintShow } from '@roomkit/shared';
import { Emitter } from './emitter.js';

/**
 * How the hintphone talks to RoomKit:
 * - 'helper': the site runs inside a player device window and bridges through
 *   `@roomkit/helper` (postMessage) — no own server connection, no code.
 * - 'client': the site is a device in its own right and connects through
 *   `@roomkit/client` with a device code.
 */
export type HintphoneMode = 'client' | 'helper';

export type HintphoneConnectionState =
  /** Client mode without a device code — ask the operator for one. */
  | 'needs-code'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface HintphoneConnectionOptions {
  /**
   * 'auto' (default) picks 'helper' when the page runs inside an iframe (the
   * player embeds device websites) and 'client' otherwise.
   */
  mode?: HintphoneMode | 'auto';
  /** http(s) origin of the RoomKit server. Required in client mode. */
  serverUrl?: string;
  /**
   * Device code for client mode. When omitted, the connection starts in
   * 'needs-code' and waits for {@link HintphoneConnection.setDeviceCode}
   * (the Setup components render a dialog for this).
   */
  deviceCode?: string;
  /** Optional label sent in the client handshake. */
  deviceName?: string;
  /**
   * Remember a dialog-entered device code in localStorage and reuse it on the
   * next load. Default true. Codes passed via `deviceCode` are never stored.
   */
  persistDeviceCode?: boolean;
  /** Disable the helper's kiosk lockdown while developing in a browser. */
  lockdown?: boolean;
  /** Console-log the underlying client/helper traffic. Default false. */
  debug?: boolean;
}

export interface HintphoneConnectionEvents extends Record<string, unknown[]> {
  hint: [HintShow];
  hintError: [HintError];
  state: [HintphoneConnectionState];
}

/**
 * The slice of {@link HintphoneConnection} the controller and counter need —
 * kept as an interface so tests (and custom transports) can substitute one.
 */
export interface HintphoneEventSource {
  readonly state: HintphoneConnectionState;
  submitHint(code: string): void;
  requestHintStep(hintId: string, step: number): void;
  on<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this;
  off<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this;
}

/** Storage key for dialog-entered device codes, scoped per server origin. */
export function hintphoneCodeKey(serverUrl: string): string {
  let origin = serverUrl;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    // keep the raw string; the key just has to be stable
  }
  return `roomkit.hintphone.deviceCode:${origin}`;
}

function inIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.parent !== window;
  } catch {
    // Cross-origin parent access throws — which itself proves an iframe.
    return true;
  }
}

function localStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * One connection to RoomKit for a hintphone site, over either transport.
 * Construct, subscribe, then call {@link connect}. In client mode without a
 * code it parks in 'needs-code' until {@link setDeviceCode}.
 */
export class HintphoneConnection {
  readonly mode: HintphoneMode;
  private readonly emitter = new Emitter<HintphoneConnectionEvents>();
  private currentState: HintphoneConnectionState = 'needs-code';
  private client: RoomKitClient | null = null;
  private helper: RoomKitHelper | null = null;
  private destroyed = false;
  /** True when the active client uses a dialog-entered (stored) code. */
  private usingEnteredCode = false;

  constructor(private readonly options: HintphoneConnectionOptions = {}) {
    this.mode =
      options.mode === undefined || options.mode === 'auto'
        ? inIframe()
          ? 'helper'
          : 'client'
        : options.mode;
  }

  get state(): HintphoneConnectionState {
    return this.currentState;
  }

  /** Underlying client (client mode, after connect) — escape hatch. */
  get roomKitClient(): RoomKitClient | null {
    return this.client;
  }

  /** Underlying helper (helper mode, after connect) — escape hatch. */
  get roomKitHelper(): RoomKitHelper | null {
    return this.helper;
  }

  connect(): void {
    if (this.destroyed || this.helper || this.client) return;
    if (this.mode === 'helper') {
      const helper = new RoomKitHelper({ lockdown: this.options.lockdown });
      helper.on('hint', (hint) => this.emitter.emit('hint', hint));
      helper.on('hintError', (error) => this.emitter.emit('hintError', error));
      this.helper = helper;
      // The helper has no connection lifecycle of its own (the player owns
      // the socket) — report connected as soon as the bridge is up.
      this.setState('connected');
      return;
    }
    const code = this.options.deviceCode ?? this.storedCode();
    if (!code) {
      this.setState('needs-code');
      return;
    }
    this.startClient(code, code !== this.options.deviceCode);
  }

  /**
   * Client mode: use a (dialog-entered) device code and connect. Stored for
   * the next load unless `persistDeviceCode: false`.
   */
  setDeviceCode(code: string): void {
    if (this.destroyed || this.mode !== 'client') return;
    const trimmed = code.trim();
    if (!trimmed) return;
    if (this.options.persistDeviceCode !== false) {
      localStore()?.setItem(hintphoneCodeKey(this.options.serverUrl ?? ''), trimmed);
    }
    const old = this.client;
    this.client = null;
    old?.disconnect();
    this.startClient(trimmed, true);
  }

  /** Forget a stored dialog-entered code and go back to 'needs-code'. */
  clearDeviceCode(): void {
    localStore()?.removeItem(hintphoneCodeKey(this.options.serverUrl ?? ''));
    if (this.mode !== 'client' || this.options.deviceCode) return;
    const old = this.client;
    this.client = null;
    old?.disconnect();
    this.setState('needs-code');
  }

  /** Submit an entered hint code; the reply arrives as 'hint' / 'hintError'. */
  submitHint(code: string): void {
    this.client?.submitHint(code);
    this.helper?.submitHint(code);
  }

  /**
   * Request the exact 0-based step of an already-shown hint. `stepCount`
   * requests the hint's explicit answer (when `hasAnswer` is set).
   */
  requestHintStep(hintId: string, step: number): void {
    this.client?.requestHintStep(hintId, step);
    this.helper?.requestHintStep(hintId, step);
  }

  on<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  destroy(): void {
    this.destroyed = true;
    this.client?.disconnect();
    this.client = null;
    this.helper?.destroy();
    this.helper = null;
  }

  private storedCode(): string | null {
    if (this.options.persistDeviceCode === false) return null;
    return localStore()?.getItem(hintphoneCodeKey(this.options.serverUrl ?? '')) ?? null;
  }

  private startClient(code: string, entered: boolean): void {
    const serverUrl = this.options.serverUrl;
    if (!serverUrl) {
      // eslint-disable-next-line no-console
      console.warn('[roomkit-hintphone] client mode requires serverUrl');
      this.setState('error');
      return;
    }
    this.usingEnteredCode = entered;
    const client = new RoomKitClient({
      serverUrl,
      deviceCode: code,
      deviceName: this.options.deviceName ?? 'hintphone',
      debug: this.options.debug,
    });
    // Identity guards: a replaced client keeps emitting during teardown.
    client.on('hint', (hint) => {
      if (this.client === client) this.emitter.emit('hint', hint);
    });
    client.on('hintError', (error) => {
      if (this.client === client) this.emitter.emit('hintError', error);
    });
    client.on('status', (status) => {
      if (this.client === client) this.handleClientStatus(status);
    });
    this.client = client;
    client.connect();
  }

  private handleClientStatus(status: ConnectionStatus): void {
    if (this.destroyed) return;
    if (status === 'error' && this.usingEnteredCode) {
      // A dialog-entered code was rejected (invalid_code / session_ended):
      // forget it and ask again instead of surfacing a dead 'error' state.
      localStore()?.removeItem(hintphoneCodeKey(this.options.serverUrl ?? ''));
      const client = this.client;
      this.client = null;
      client?.disconnect();
      this.setState('needs-code');
      return;
    }
    const map: Record<ConnectionStatus, HintphoneConnectionState> = {
      idle: 'disconnected',
      connecting: 'connecting',
      connected: 'connected',
      disconnected: 'disconnected',
      error: 'error',
    };
    this.setState(map[status]);
  }

  private setState(state: HintphoneConnectionState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emitter.emit('state', state);
  }
}
