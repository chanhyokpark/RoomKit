import { Injectable } from '@nestjs/common';
import {
  DEVICE_LOG_BUFFER_LINES,
  type DeviceLogBatch,
  type DeviceLogLine,
  type DeviceLogLineInput,
} from '@roomkit/shared';

/** Buffers older than this are dropped on the next write (abandoned sessions). */
const BUFFER_TTL_MS = 12 * 60 * 60 * 1000;

interface DeviceLogBuffer {
  lines: DeviceLogLine[];
  nextSeq: number;
  touchedAt: number;
}

/**
 * In-memory ring buffer of player log lines per session+device. Lines
 * outlive the device socket (a window that crashed or was closed is exactly
 * the one an operator wants to read) and are dropped when the session ends
 * or the buffer goes stale.
 */
@Injectable()
export class DeviceLogsService {
  private readonly buffers = new Map<string, DeviceLogBuffer>();

  /** Stores a report; returns the stored lines (with `seq`) for broadcasting. */
  append(
    sessionId: string,
    deviceId: string,
    input: DeviceLogLineInput[],
  ): DeviceLogBatch {
    this.prune();
    const key = `${sessionId}:${deviceId}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = { lines: [], nextSeq: 0, touchedAt: Date.now() };
      this.buffers.set(key, buffer);
    }
    buffer.touchedAt = Date.now();
    const lines = input.map((line) => ({ ...line, seq: buffer.nextSeq++ }));
    buffer.lines.push(...lines);
    if (buffer.lines.length > DEVICE_LOG_BUFFER_LINES) {
      buffer.lines.splice(0, buffer.lines.length - DEVICE_LOG_BUFFER_LINES);
    }
    return { sessionId, deviceId, lines };
  }

  /** Everything buffered for one device, oldest first. */
  list(sessionId: string, deviceId: string): DeviceLogLine[] {
    return this.buffers.get(`${sessionId}:${deviceId}`)?.lines ?? [];
  }

  clearSession(sessionId: string): void {
    for (const key of this.buffers.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.buffers.delete(key);
    }
  }

  private prune(): void {
    const cutoff = Date.now() - BUFFER_TTL_MS;
    for (const [key, buffer] of this.buffers) {
      if (buffer.touchedAt < cutoff) this.buffers.delete(key);
    }
  }
}
