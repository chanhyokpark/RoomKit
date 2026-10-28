import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  DeviceEvents,
  DeviceEvalResultSchema,
  DeviceWindowResultSchema,
  type DeviceEvalInput,
  type DeviceEvalResult,
  type DeviceReloadInput,
  type DeviceReloadResult,
  type DeviceWindowInput,
  type DeviceWindowResult,
} from '@roomkit/shared';
import type { Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ConnectionRegistry } from './connection-registry';

type LiveSession = { id: string; mode: string; state: string };

/** Extra time for transport and capture on top of the script/window deadline. */
const RPC_GRACE_MS = 7000;

/**
 * Test-only device RPCs that bypass the authored command pipeline: JS
 * evaluation in the website, window focus/capture, and website reload.
 * Each targets exactly one connected player window and never retries.
 */
@Injectable()
export class DeviceEvalService {
  private readonly pending = new Set<string>();

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly runtime: SessionRuntimeService,
  ) {}

  async evaluate(
    session: LiveSession,
    deviceId: string,
    input: DeviceEvalInput,
  ): Promise<DeviceEvalResult> {
    return this.rpc(session, deviceId, {
      event: DeviceEvents.evaluate,
      input,
      timeoutMs: input.timeoutMs,
      schema: DeviceEvalResultSchema,
      requires: 'JS evaluation',
      busy: 'Another evaluation is running on this device',
      unavailable: (requestId) => ({
        requestId,
        result: {
          ok: false,
          error: {
            code: 'device_unavailable',
            message:
              'Device disconnected or did not reply before the deadline. Execution may still have happened; do not automatically retry.',
          },
        },
      }),
      invalid: (requestId) => ({
        requestId,
        result: {
          ok: false,
          error: {
            code: 'invalid_result',
            message:
              'Device returned an invalid or mismatched evaluation result',
          },
        },
      }),
    });
  }

  /** Bring the device window to the front and/or capture it (no website needed). */
  async window(
    session: LiveSession,
    deviceId: string,
    input: DeviceWindowInput,
  ): Promise<DeviceWindowResult> {
    return this.rpc(session, deviceId, {
      event: DeviceEvents.window,
      input,
      timeoutMs: input.timeoutMs,
      schema: DeviceWindowResultSchema,
      requires: 'Window requests',
      busy: 'Another request is running on this device',
      unavailable: (requestId) => ({
        requestId,
        result: {
          ok: false,
          error: {
            code: 'device_unavailable',
            message:
              'Device disconnected or did not reply before the deadline.',
          },
        },
      }),
      invalid: (requestId) => ({
        requestId,
        result: {
          ok: false,
          error: {
            code: 'invalid_result',
            message: 'Device returned an invalid or mismatched window result',
          },
        },
      }),
    });
  }

  /**
   * Force-reload the website the device shows: the runtime re-sends the last
   * navigate with `force: true` and waits for the load ack; with `waitReady`
   * the reply also waits for the reloaded page's Helper hello (armed before
   * the navigate so a fast hello is not missed).
   */
  async reload(
    session: LiveSession,
    deviceId: string,
    input: DeviceReloadInput,
  ): Promise<DeviceReloadResult> {
    this.assertLiveTest(session, 'Website reload');
    // Reload uses the authored navigate wire, which the runtime broadcasts
    // to every socket of the device — still require one window so the load
    // ack and the helper hello are unambiguous.
    this.targetSocket(session, deviceId);
    const key = `${session.id}:${deviceId}`;
    if (this.pending.has(key))
      throw new ConflictException('Another request is running on this device');
    this.pending.add(key);
    // The hello waiter's own timeout bounds the whole call: the navigate ack
    // and the hello share one deadline from the request's start.
    const hello = input.waitReady
      ? this.registry.waitForHelperInfo(session.id, deviceId, input.timeoutMs)
      : null;
    try {
      const reloaded = await this.runtime.reloadWebsite(
        session.id,
        deviceId,
        input.timeoutMs,
      );
      const result: DeviceReloadResult = {
        ...reloaded,
        loaded: reloaded.status === 'done',
      };
      if (hello) {
        if (!result.loaded) hello.cancel();
        const versions = await hello.promise;
        result.helperReady = versions !== null;
        if (versions) {
          result.helperVersion = versions.helperVersion ?? null;
          result.helperTestCallbacks = versions.helperTestCallbacks ?? null;
        }
      }
      return result;
    } finally {
      hello?.cancel();
      this.pending.delete(key);
    }
  }

  private assertLiveTest(session: LiveSession, what: string): void {
    if (session.mode !== 'test' || session.state === 'ended') {
      throw new BadRequestException(`${what} requires a live test session`);
    }
  }

  /** Script RPCs must target exactly one window, never broadcast mutations. */
  private targetSocket(session: LiveSession, deviceId: string): Socket {
    const sockets = this.registry.socketsFor(session.id, deviceId);
    if (sockets.length !== 1) {
      throw new ConflictException(
        sockets.length
          ? 'Device has multiple windows; close duplicates before evaluating'
          : 'Device is offline in this session',
      );
    }
    return sockets[0];
  }

  private async rpc<Input extends object, Result extends { requestId: string }>(
    session: LiveSession,
    deviceId: string,
    spec: {
      event: string;
      input: Input;
      timeoutMs: number;
      schema: ZodType<Result>;
      /** Subject of the "… requires a live test session" refusal. */
      requires: string;
      busy: string;
      unavailable: (requestId: string) => Result;
      invalid: (requestId: string) => Result;
    },
  ): Promise<Result> {
    this.assertLiveTest(session, spec.requires);
    const socket = this.targetSocket(session, deviceId);
    const key = `${session.id}:${deviceId}`;
    if (this.pending.has(key)) throw new ConflictException(spec.busy);
    this.pending.add(key);
    const requestId = randomUUID();
    try {
      // Acknowledgement belongs to this one socket and request. Never retry.
      const raw: unknown = await socket
        .timeout(spec.timeoutMs + RPC_GRACE_MS)
        .emitWithAck(spec.event, { ...spec.input, requestId });
      const parsed = spec.schema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId) {
        return spec.invalid(requestId);
      }
      const data = parsed.data as Result & {
        result: { ok: boolean };
        screenshot?: unknown;
        screenshotError?: unknown;
      };
      if (
        'screenshot' in spec.input &&
        (spec.input as { screenshot?: boolean }).screenshot &&
        data.result.ok &&
        !data.screenshot &&
        !data.screenshotError
      ) {
        data.screenshotError = {
          code: 'capture_failed',
          message: 'Device did not return the requested screenshot',
        };
      }
      return data;
    } catch {
      return spec.unavailable(requestId);
    } finally {
      this.pending.delete(key);
    }
  }
}
