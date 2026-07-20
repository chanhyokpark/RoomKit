import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Session } from '@prisma/client';
import type {
  Ack,
  AdjustTimerInput,
  PlaybackProgress,
  SessionState,
  Trigger,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { CommandResolver } from './command-resolver';
import { EngineStateError, SessionEngine } from './session-engine';
import { NOOP_TRANSPORT, type RuntimeTransport } from './runtime-transport';

/**
 * Registry of live session engines. The single authority for live-state
 * mutations — SessionsService (REST) and the gateways both call into here.
 */
@Injectable()
export class SessionRuntimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionRuntimeService.name);
  private readonly engines = new Map<string, SessionEngine>();
  private transport: RuntimeTransport = NOOP_TRANSPORT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
    private readonly resolver: CommandResolver,
  ) {}

  /** Called by the gateway module once its namespaces are up. */
  registerTransport(transport: RuntimeTransport): void {
    this.transport = transport;
  }

  /** Restart recovery: rebuild engines for every non-ended session. */
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.prisma.session.findMany({
      where: { state: { not: 'ended' } },
      include: { theme: { select: { timeLimitMs: true } } },
    });
    for (const row of rows) {
      const engine = this.buildEngine(row, row.theme.timeLimitMs);
      this.engines.set(row.id, engine);
      engine.recover(row);
    }
    if (rows.length > 0) {
      this.logger.log(`Recovered ${rows.length} active session(s)`);
    }
  }

  /** Release timers/handles; sessions stay live in the DB for recovery. */
  onModuleDestroy(): void {
    for (const engine of this.engines.values()) engine.dispose();
    this.engines.clear();
  }

  /** Boot the engine for a freshly created session (create = start). */
  attach(row: Session, timeLimitMs: number | null): void {
    const engine = this.buildEngine(row, timeLimitMs);
    this.engines.set(row.id, engine);
    engine.start();
  }

  async pause(sessionId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    this.wrap(() => engine.pause());
    await engine.flush();
  }

  async resume(sessionId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    this.wrap(() => engine.resume());
    await engine.flush();
  }

  async end(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId);
    if (!engine) return; // already ended (or never live) — idempotent
    await engine.end();
    this.engines.delete(sessionId);
  }

  async adjustTimer(sessionId: string, adjustment: AdjustTimerInput): Promise<void> {
    const engine = this.getEngine(sessionId);
    this.wrap(() => engine.adjustTimer(adjustment));
    await engine.flush();
  }

  async switchPhase(sessionId: string, phaseId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    await this.wrapAsync(() => engine.forceSwitchPhase(phaseId));
    await engine.flush();
  }

  async manualTrigger(sessionId: string, eventId: string): Promise<void> {
    await this.wrapAsync(() => this.getEngine(sessionId).manualTrigger(eventId));
  }

  async resetAllDevices(sessionId: string): Promise<void> {
    await this.wrapAsync(() => this.getEngine(sessionId).resetAllDevices());
  }

  // ── gateway entry points ─────────────────────────────────────────────────

  handleDeviceTrigger(sessionId: string, deviceId: string, trigger: Trigger): void {
    const engine = this.engines.get(sessionId);
    if (!engine) return;
    void engine.handleTrigger(trigger.event, `device ${deviceId}`);
  }

  handleAck(sessionId: string, deviceId: string, ack: Ack): void {
    this.engines.get(sessionId)?.handleAck(deviceId, ack.commandId, ack.status);
  }

  handleProgress(sessionId: string, deviceId: string, progress: PlaybackProgress): void {
    this.engines.get(sessionId)?.handleProgress(deviceId, progress);
  }

  onDeviceConnected(sessionId: string, deviceId: string): void {
    this.engines.get(sessionId)?.onDeviceConnected(deviceId);
  }

  deviceStatusChanged(
    sessionId: string,
    deviceId: string,
    deviceName: string,
    online: boolean,
  ): void {
    this.engines.get(sessionId)?.deviceStatusChanged(deviceId, deviceName, online);
  }

  /** Live state for one session (null when not live). */
  getSessionState(sessionId: string): SessionState | null {
    return this.engines.get(sessionId)?.sessionState() ?? null;
  }

  /** All live session states — the /admin connect dump. */
  listSessionStates(): SessionState[] {
    return [...this.engines.values()].map((e) => e.sessionState());
  }

  isLive(sessionId: string): boolean {
    return this.engines.has(sessionId);
  }

  private buildEngine(row: Session, timeLimitMs: number | null): SessionEngine {
    return new SessionEngine(row, timeLimitMs, {
      prisma: this.prisma,
      logs: this.logs,
      resolver: this.resolver,
      transport: () => this.transport,
    });
  }

  private getEngine(sessionId: string): SessionEngine {
    const engine = this.engines.get(sessionId);
    if (!engine) {
      throw new NotFoundException('Session is not live (ended or unknown)');
    }
    return engine;
  }

  private wrap<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw toHttp(err);
    }
  }

  private async wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw toHttp(err);
    }
  }
}

function toHttp(err: unknown): unknown {
  if (err instanceof EngineStateError) {
    // State-transition conflicts read better as 409; validation-ish ones as 400.
    return /Cannot (pause|resume)/.test(err.message)
      ? new ConflictException(err.message)
      : new BadRequestException(err.message);
  }
  return err;
}
