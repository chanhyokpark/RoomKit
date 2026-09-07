import { io, type Socket } from 'socket.io-client';
import { DEVICE_NAMESPACE, FATAL_CONNECT_ERRORS } from '@roomkit/shared';
import { requireLogin, SessionState, ToolError } from './session.js';

export interface DeviceLogEntry {
  at: string;
  direction: 'recv' | 'sent';
  event: string;
  payload: unknown;
}

/** Live feed of every logged device event (for `rk device connect` streaming). */
export type DeviceEventListener = (code: string, entry: DeviceLogEntry) => void;

export type DeviceStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceRecord {
  code: string;
  socket: Socket;
  status: DeviceStatus;
  error: string | null;
  /** Device identity from the welcome payload, once attached. */
  device: unknown;
  log: DeviceLogEntry[];
}

export interface DeviceState {
  code: string;
  status: DeviceStatus;
  error: string | null;
  device: unknown;
}

const LOG_LIMIT = 200;
const CONNECT_TIMEOUT_MS = 8000;

/**
 * Headless fake devices: in-process socket.io connections to the /device
 * namespace (same handshake as a real player window). Every received command
 * is logged and acked 'done' immediately, so sequences progress without
 * real playback — fast, logic-accurate, timing-unrealistic.
 */
export class VirtualDeviceManager {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly listeners = new Set<DeviceEventListener>();

  constructor(private readonly state: SessionState) {}

  /** Subscribe to every logged entry (received events, sent acks/triggers). Returns an unsubscribe. */
  onEvent(listener: DeviceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitEvent(code: string, entry: DeviceLogEntry): void {
    for (const listener of this.listeners) listener(code, entry);
  }

  async connect(code: string): Promise<{ code: string; status: DeviceStatus; error: string | null }> {
    requireLogin(this.state);
    this.devices.get(code)?.socket.disconnect();

    const socket = io(`${this.state.apiUrl}${DEVICE_NAMESPACE}`, {
      auth: { deviceCode: code, deviceName: `rk-virtual:${code}` },
      transports: ['websocket'],
    });
    const record: DeviceRecord = {
      code,
      socket,
      status: 'connecting',
      error: null,
      device: null,
      log: [],
    };
    this.devices.set(code, record);

    const push = (entry: DeviceLogEntry) => {
      record.log.push(entry);
      if (record.log.length > LOG_LIMIT) record.log.splice(0, record.log.length - LOG_LIMIT);
      this.emitEvent(code, entry);
    };
    socket.onAny((event: string, ...args: unknown[]) => {
      push({ at: new Date().toISOString(), direction: 'recv', event, payload: args[0] ?? null });
      if (event === 'welcome' && args[0] && typeof args[0] === 'object') {
        record.device = (args[0] as { device?: unknown }).device ?? null;
      }
      if (event === 'command' && args[0] && typeof args[0] === 'object' && 'id' in (args[0] as object)) {
        const ack = { commandId: (args[0] as { id: string }).id, status: 'done' as const };
        socket.emit('ack', ack);
        push({ at: new Date().toISOString(), direction: 'sent', event: 'ack', payload: ack });
      }
    });
    socket.on('connect', () => {
      record.status = 'connected';
      record.error = null;
    });
    socket.on('disconnect', (reason: string) => {
      if (record.status !== 'error') {
        record.status = 'disconnected';
        record.error = reason;
      }
    });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        record.status = 'error';
        record.error = record.error ?? `No connection after ${CONNECT_TIMEOUT_MS}ms`;
        socket.disconnect();
        resolve();
      }, CONNECT_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on('connect_error', (err: Error) => {
        record.error = err.message;
        // Transient errors keep retrying until the timeout; fatal ones stop.
        if ((FATAL_CONNECT_ERRORS as readonly string[]).includes(err.message)) {
          clearTimeout(timeout);
          record.status = 'error';
          socket.disconnect();
          resolve();
        }
      });
    });
    return { code, status: record.status, error: record.error };
  }

  /**
   * Emits a device trigger. With waitForCompletion, resolves once every event
   * run the trigger started has fully finished (the server's trigger ack).
   */
  async trigger(
    code: string,
    event: string,
    payload: unknown,
    waitForCompletion: boolean,
    timeoutMs: number,
  ): Promise<{ delivered: boolean; runsCompleted: boolean; note?: string }> {
    const record = this.require(code);
    const body = payload === undefined ? { event } : { event, payload };
    const sent: DeviceLogEntry = { at: new Date().toISOString(), direction: 'sent', event: 'trigger', payload: body };
    record.log.push(sent);
    this.emitEvent(code, sent);
    if (!waitForCompletion) {
      record.socket.emit('trigger', body);
      return { delivered: true, runsCompleted: false, note: 'Fired without waiting; run `rk session logs` to observe the event runs.' };
    }
    try {
      await record.socket.timeout(timeoutMs).emitWithAck('trigger', body);
      return { delivered: true, runsCompleted: true };
    } catch {
      return {
        delivered: true,
        runsCompleted: false,
        note: `Event runs did not finish within ${timeoutMs}ms — they may still be running (long waits/playback). Run \`rk session logs\`.`,
      };
    }
  }

  states(): DeviceState[] {
    return [...this.devices.values()].map((r) => ({
      code: r.code,
      status: r.status,
      error: r.error,
      device: r.device,
    }));
  }

  log(code: string, limit: number): DeviceLogEntry[] {
    return this.require(code).log.slice(-limit);
  }

  disconnect(codes?: string[]): string[] {
    const targets = codes ?? [...this.devices.keys()];
    const dropped: string[] = [];
    for (const code of targets) {
      const record = this.devices.get(code);
      if (!record) continue;
      record.socket.disconnect();
      this.devices.delete(code);
      dropped.push(code);
    }
    return dropped;
  }

  private require(code: string): DeviceRecord {
    const record = this.devices.get(code);
    if (!record) {
      throw new ToolError(
        `No virtual device with code "${code}". Connect it first with \`rk device connect\`.`,
      );
    }
    return record;
  }
}
