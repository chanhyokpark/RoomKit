import { randomInt } from 'node:crypto';
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
  type DeviceCodeInput,
  type JsonValue,
  type ListSessionsQuery,
  type SessionResponse,
  type TestDeviceCode,
} from '@roomkit/shared';
import { PlayerRegistry } from '../players/player-registry';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';

// No 0/1/l/o — codes get read aloud and typed on devices.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 6;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: SessionRuntimeService,
    private readonly players: PlayerRegistry,
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
   * the game. Test-mode device codes are either operator-entered (validated
   * against the theme's devices) or, when `playerId` is given, generated for
   * every theme device and pushed to the connected player launcher, which
   * opens its device windows automatically.
   */
  async create(input: CreateSessionInput): Promise<SessionResponse> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: input.themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    if (input.playerId && !this.players.isOnline(input.playerId)) {
      throw new BadRequestException('Player is not connected');
    }

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

    let deviceCodes = input.mode === 'test' ? (input.deviceCodes ?? []) : [];
    if (input.mode === 'test' && input.playerId) {
      deviceCodes = await this.generateDeviceCodes(theme.id, input.deviceIds);
    }
    if (deviceCodes.length > 0) {
      await this.validateDeviceCodes(theme.id, deviceCodes);
    }
    const urlOverrides = await this.validateUrlOverrides(
      theme.id,
      input.urlOverrides,
    );

    const phaseId = await this.getInitialPhaseId(theme.id);
    let row: Session;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const session = await tx.session.create({
          data: {
            themeId: theme.id,
            mode: input.mode,
            phaseId,
            urlOverrides,
            // Player-created test sessions auto-end when their devices are gone.
            autoEnd: input.playerId !== undefined,
          },
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
    const response = await this.get(row.id);
    if (input.playerId) {
      this.players.sendTestStart(input.playerId, {
        sessionId: row.id,
        themeId: theme.id,
        devices: response.testDeviceCodes ?? [],
      });
    }
    return response;
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

  /**
   * Fresh random codes for every device of the theme, checked against live
   * sessions. The unique constraint still guards races; a create that loses
   * one surfaces as the existing 409.
   */
  private async generateDeviceCodes(
    themeId: string,
    deviceIds?: string[],
  ): Promise<DeviceCodeInput[]> {
    const devices = await this.prisma.asset.findMany({
      where: {
        themeId,
        kind: 'device',
        ...(deviceIds !== undefined ? { id: { in: deviceIds } } : {}),
      },
      select: { id: true },
    });
    if (deviceIds !== undefined && devices.length !== new Set(deviceIds).size) {
      throw new BadRequestException('deviceIds reference unknown devices');
    }
    if (devices.length === 0) return [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const codes = new Set<string>();
      while (codes.size < devices.length) codes.add(this.randomCode());
      const pool = [...codes];
      const taken = await this.prisma.sessionDeviceCode.findFirst({
        where: { code: { in: pool } },
        select: { id: true },
      });
      if (!taken) {
        return devices.map((device, i) => ({
          deviceId: device.id,
          code: pool[i],
        }));
      }
    }
    throw new ConflictException('Could not generate unique device codes');
  }

  private randomCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
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

  /** Validates override targets are theme website assets; returns the stored map. */
  private async validateUrlOverrides(
    themeId: string,
    overrides: { websiteId: string; url: string }[] | undefined,
  ): Promise<Record<string, string>> {
    if (overrides === undefined || overrides.length === 0) return {};
    const websiteIds = overrides.map((o) => o.websiteId);
    if (new Set(websiteIds).size !== websiteIds.length) {
      throw new BadRequestException('Each website may have only one override');
    }
    const websites = await this.prisma.asset.findMany({
      where: { id: { in: websiteIds }, themeId, kind: 'website' },
      select: { id: true },
    });
    if (websites.length !== websiteIds.length) {
      throw new BadRequestException('urlOverrides reference unknown websites');
    }
    return Object.fromEntries(overrides.map((o) => [o.websiteId, o.url]));
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
    verdict: row.verdict,
    vars: (row.vars ?? {}) as Record<string, JsonValue>,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    timerEndsAt: row.timerEndsAt,
    timerRemainingMs: row.timerRemainingMs,
    urlOverrides:
      row.urlOverrides !== null &&
      typeof row.urlOverrides === 'object' &&
      !Array.isArray(row.urlOverrides)
        ? (row.urlOverrides as Record<string, string>)
        : {},
  };
}
