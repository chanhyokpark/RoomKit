import { randomInt } from 'node:crypto';
import {
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

// No 0/1/l/o — codes get read aloud and typed on devices.
const TEST_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TEST_CODE_LENGTH = 10;

export function generateTestCode(): string {
  let code = 'tst_';
  for (let i = 0; i < TEST_CODE_LENGTH; i++) {
    code += TEST_CODE_ALPHABET[randomInt(TEST_CODE_ALPHABET.length)];
  }
  return code;
}

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
   * Create = start: the session row is inserted (with per-device test codes
   * for test mode), then the runtime engine boots — arming the timer and
   * firing the session:start hook.
   */
  async create(input: CreateSessionInput): Promise<SessionResponse> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: input.themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    if (input.mode === 'production') {
      const active = await this.prisma.session.findFirst({
        where: { themeId: theme.id, mode: 'production', state: { not: 'ended' } },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'Theme already has an active production session',
        );
      }
    }

    const phaseId = await this.getInitialPhaseId(theme.id);
    let row: Session;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const session = await tx.session.create({
          data: { themeId: theme.id, mode: input.mode, phaseId },
        });
        if (input.mode === 'test') {
          const devices = await tx.asset.findMany({
            where: { themeId: theme.id, kind: 'device' },
            select: { id: true },
          });
          await tx.sessionDeviceCode.createMany({
            data: devices.map((d) => ({
              sessionId: session.id,
              deviceId: d.id,
              code: generateTestCode(),
            })),
          });
        }
        return session;
      });
    } catch (err) {
      // Race on the partial unique index (one active production per theme).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Theme already has an active production session',
        );
      }
      throw err;
    }

    this.runtime.attach(row, theme.timeLimitMs);
    return this.get(row.id);
  }

  private async getTestDeviceCodes(sessionId: string): Promise<TestDeviceCode[]> {
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
