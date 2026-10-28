import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  DeviceEvents,
  DeviceEvalResultSchema,
  type DeviceEvalInput,
  type DeviceEvalResult,
} from '@roomkit/shared';
import { ConnectionRegistry } from './connection-registry';

@Injectable()
export class DeviceEvalService {
  private readonly pending = new Set<string>();

  constructor(private readonly registry: ConnectionRegistry) {}

  async evaluate(
    session: { id: string; mode: string; state: string },
    deviceId: string,
    input: DeviceEvalInput,
  ): Promise<DeviceEvalResult> {
    if (session.mode !== 'test' || session.state === 'ended') {
      throw new BadRequestException(
        'JS evaluation requires a live test session',
      );
    }
    const sockets = this.registry.socketsFor(session.id, deviceId);
    if (sockets.length !== 1) {
      throw new ConflictException(
        sockets.length
          ? 'Device has multiple windows; close duplicates before evaluating'
          : 'Device is offline in this session',
      );
    }
    const key = `${session.id}:${deviceId}`;
    if (this.pending.has(key))
      throw new ConflictException(
        'Another evaluation is running on this device',
      );
    this.pending.add(key);
    const requestId = randomUUID();
    try {
      // Acknowledgement belongs to this one socket and request. Never retry JS.
      const raw: unknown = await sockets[0]
        .timeout(input.timeoutMs + 7000)
        .emitWithAck(DeviceEvents.evaluate, { ...input, requestId });
      const parsed = DeviceEvalResultSchema.safeParse(raw);
      if (!parsed.success || parsed.data.requestId !== requestId) {
        return {
          requestId,
          result: {
            ok: false,
            error: {
              code: 'invalid_result',
              message:
                'Device returned an invalid or mismatched evaluation result',
            },
          },
        };
      }
      if (
        input.screenshot &&
        parsed.data.result.ok &&
        !parsed.data.screenshot &&
        !parsed.data.screenshotError
      ) {
        parsed.data.screenshotError = {
          code: 'capture_failed',
          message: 'Device did not return the requested screenshot',
        };
      }
      return parsed.data;
    } catch {
      return {
        requestId,
        result: {
          ok: false,
          error: {
            code: 'device_unavailable',
            message:
              'Device disconnected or did not reply before the deadline. Execution may still have happened; do not automatically retry.',
          },
        },
      };
    } finally {
      this.pending.delete(key);
    }
  }
}
