import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Session } from '@prisma/client';
import {
  DeviceDataSchema,
  PhaseDataSchema,
  type CreateSessionInput,
  type JsonValue,
  type ListSessionsQuery,
  type SessionResponse,
  type TestDeviceCode,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: SessionRuntimeService,
  ) {}

  async list(query: ListSessionsQuery): Promise<SessionResponse[]> {
    const rows = await this.prisma.session.findMany({
      where: {
        ...(query.themeId ? { themeId: query.themeId } : {}),
        ...(query.active === 'true' ? { state: { not: 'ended' } } : {}),
        ...(query.active === 'false' ? { state: 'ended' } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(serialize);
  }

  async get(id: string): Promise<SessionResponse> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Session not found');
    const response = serialize(row);
    if (row.mode === 'test') {
      response.testDeviceCodes = await this.getTestDeviceCodes(id);
    }
    return response;
  }

  /**
   * Creates an idle session (state 'created'); POST /sessions/:id/start begins
   * the game. Test-mode device codes are operator-entered (validated against
   * the theme's devices), not generated.
   */
  async create(input: CreateSessionInput): Promise<SessionResponse> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: input.themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    if (input.mode === 'production') {
      const active = await this.prisma.session.findFirst({
        where: {
          themeId: theme.id,
          mode: 'production',
          state: { not: 'ended' },
        },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'Theme already has an active production session',
        );
      }
    }

    const deviceCodes = input.mode === 'test' ? (input.deviceCodes ?? []) : [];
    if (deviceCodes.length > 0) {
      await this.validateDeviceCodes(theme.id, deviceCodes);
    }

    const phaseId = await this.getInitialPhaseId(theme.id);
    let row: Session;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const session = await tx.session.create({
          data: { themeId: theme.id, mode: input.mode, phaseId },
        });
        if (deviceCodes.length > 0) {
          await tx.sessionDeviceCode.createMany({
            data: deviceCodes.map((entry) => ({
              sessionId: session.id,
              deviceId: entry.deviceId,
              code: entry.code,
            })),
          });
        }
        return session;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Either the partial unique index (one active production per theme)
        // or a device-code collision with another live session.
        const target =
          (err.meta?.target as string[] | string | undefined) ?? '';
        if (String(target).includes('code')) {
          throw new ConflictException(
            'A device code is already in use by another session',
          );
        }
        throw new ConflictException(
          'Theme already has an active production session',
        );
      }
      throw err;
    }

    this.runtime.attach(row, theme.timeLimitMs);
    return this.get(row.id);
  }

  /** Ends the session and frees its test device codes. */
  async end(id: string): Promise<SessionResponse> {
    await this.get(id);
    await this.runtime.end(id);
    await this.prisma.sessionDeviceCode.deleteMany({
      where: { sessionId: id },
    });
    return this.get(id);
  }

  /**
   * Permanently removes a session and its logs/device codes. Live sessions
   * must be ended first; a 'created' session still has an idle engine, which
   * end() tears down (and is a no-op for already-ended sessions).
   */
  async delete(id: string): Promise<void> {
    const row = await this.prisma.session.findUnique({
      where: { id },
      select: { state: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    if (row.state === 'running' || row.state === 'paused') {
      throw new ConflictException('End the session before deleting it');
    }
    await this.runtime.end(id);
    await this.prisma.session.delete({ where: { id } });
  }

  private async validateDeviceCodes(
    themeId: string,
    deviceCodes: { deviceId: string; code: string }[],
  ): Promise<void> {
    const codes = deviceCodes.map((entry) => entry.code);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Device codes must be unique');
    }
    const deviceIds = deviceCodes.map((entry) => entry.deviceId);
    if (new Set(deviceIds).size !== deviceIds.length) {
      throw new BadRequestException('Each device may have only one code');
    }
    const devices = await this.prisma.asset.findMany({
      where: { id: { in: deviceIds }, themeId, kind: 'device' },
      select: { id: true },
    });
    if (devices.length !== deviceIds.length) {
      throw new BadRequestException('deviceCodes reference unknown devices');
    }
    const taken = await this.prisma.sessionDeviceCode.findFirst({
      where: { code: { in: codes } },
      select: { code: true },
    });
    if (taken) {
      throw new ConflictException(
        `Device code "${taken.code}" is already in use by another session`,
      );
    }
  }

  private async getTestDeviceCodes(
    sessionId: string,
  ): Promise<TestDeviceCode[]> {
    const codes = await this.prisma.sessionDeviceCode.findMany({
      where: { sessionId },
    });
    if (codes.length === 0) return [];
    const devices = await this.prisma.asset.findMany({
      where: { id: { in: codes.map((c) => c.deviceId) } },
      select: { id: true, name: true, data: true },
    });
    const byId = new Map(devices.map((d) => [d.id, d]));
    return codes.map((c) => {
      const device = byId.get(c.deviceId);
      const data = device ? DeviceDataSchema.safeParse(device.data) : undefined;
      return {
        deviceId: c.deviceId,
        deviceName: device?.name ?? '(deleted)',
        displayName: data?.success ? data.data.displayName : '',
        code: c.code,
      };
    });
  }

  /** The theme's lowest-order phase, or null when it has no phases. */
  private async getInitialPhaseId(themeId: string): Promise<string | null> {
    const phases = await this.prisma.asset.findMany({
      where: { themeId, kind: 'phase' },
      select: { id: true, data: true },
    });
    let best: { id: string; order: number } | null = null;
    for (const phase of phases) {
      const parsed = PhaseDataSchema.safeParse(phase.data);
      if (!parsed.success) continue;
      if (best === null || parsed.data.order < best.order) {
        best = { id: phase.id, order: parsed.data.order };
      }
    }
    return best?.id ?? null;
  }
}

function serialize(row: Session): SessionResponse {
  return {
    id: row.id,
    themeId: row.themeId,
    mode: row.mode,
    phaseId: row.phaseId,
    state: row.state,
    vars: (row.vars ?? {}) as Record<string, JsonValue>,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    timerEndsAt: row.timerEndsAt,
    timerRemainingMs: row.timerRemainingMs,
  };
}
