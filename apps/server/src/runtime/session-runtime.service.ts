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
  HintError,
  HintNext,
  HintShow,
  HintSubmit,
  PlaybackProgress,
  PushHintInput,
  SessionRuns,
  SessionState,
  Trigger,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from '../logs/logs.service';
import { CommandResolver } from './command-resolver';
import { HintService } from './hint.service';
import { EngineStateError, SessionEngine } from './session-engine';
import { NOOP_TRANSPORT, type RuntimeTransport } from './runtime-transport';

/**
 * Registry of live session engines. The single authority for live-state
 * mutations — SessionsService (REST) and the gateways both call into here.
 */
@Injectable()
export class SessionRuntimeService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SessionRuntimeService.name);
  private readonly engines = new Map<string, SessionEngine>();
  private transport: RuntimeTransport = NOOP_TRANSPORT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
    private readonly resolver: CommandResolver,
    private readonly hints: HintService,
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

  /** Boot the engine for a freshly created session (idle until started). */
  attach(row: Session, timeLimitMs: number | null): void {
    const engine = this.buildEngine(row, timeLimitMs);
    this.engines.set(row.id, engine);
    engine.attach();
  }

  async start(sessionId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    this.wrap(() => engine.start());
    await engine.flush();
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
    // engine.end() invokes onEnded, which removes the registry entry; the
    // extra delete only covers the no-op path of an already-ended engine.
    await engine.end();
    this.engines.delete(sessionId);
  }

  async adjustTimer(
    sessionId: string,
    adjustment: AdjustTimerInput,
  ): Promise<void> {
    const engine = this.getEngine(sessionId);
    this.wrap(() => engine.adjustTimer(adjustment));
    await engine.flush();
  }

  async switchPhase(sessionId: string, phaseId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    await this.wrapAsync(() => engine.forceSwitchPhase(phaseId));
    await engine.flush();
  }

  async restartPhase(sessionId: string): Promise<void> {
    const engine = this.getEngine(sessionId);
    await this.wrapAsync(() => engine.restartCurrentPhase());
    await engine.flush();
  }

  async manualTrigger(sessionId: string, eventId: string): Promise<void> {
    await this.wrapAsync(() =>
      this.getEngine(sessionId).manualTrigger(eventId),
    );
  }

  async resetAllDevices(sessionId: string): Promise<void> {
    await this.wrapAsync(() => this.getEngine(sessionId).resetAllDevices());
  }

  /** REST admin hint push. */
  async pushHint(sessionId: string, input: PushHintInput): Promise<void> {
    await this.wrapAsync(() =>
      this.getEngine(sessionId).pushHint(input.hintId, input.step),
    );
  }

  // ── gateway entry points ─────────────────────────────────────────────────

  handleDeviceTrigger(
    sessionId: string,
    deviceId: string,
    trigger: Trigger,
  ): void {
    const engine = this.engines.get(sessionId);
    if (!engine) return;
    void engine.handleTrigger(
      trigger.event,
      `device ${deviceId}`,
      trigger.payload ?? null,
    );
  }

  handleAck(sessionId: string, deviceId: string, ack: Ack): void {
    this.engines.get(sessionId)?.handleAck(deviceId, ack.commandId, ack.status);
  }

  handleProgress(
    sessionId: string,
    deviceId: string,
    progress: PlaybackProgress,
  ): void {
    this.engines.get(sessionId)?.handleProgress(deviceId, progress);
  }

  handleHintSubmit(
    sessionId: string,
    deviceId: string,
    input: HintSubmit,
  ): Promise<HintShow | HintError> {
    const engine = this.engines.get(sessionId);
    // No engine → feedback, not silence: the hint device UI needs it.
    if (!engine) return Promise.resolve({ reason: 'session_not_running' });
    return engine.handleHintSubmit(deviceId, input.code);
  }

  handleHintNext(
    sessionId: string,
    deviceId: string,
    input: HintNext,
  ): Promise<HintShow | HintError> {
    const engine = this.engines.get(sessionId);
    if (!engine) return Promise.resolve({ reason: 'session_not_running' });
    return engine.handleHintNext(deviceId, input);
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
    this.engines
      .get(sessionId)
      ?.deviceStatusChanged(deviceId, deviceName, online);
  }

  /** Live state for one session (null when not live). */
  getSessionState(sessionId: string): SessionState | null {
    return this.engines.get(sessionId)?.sessionState() ?? null;
  }

  /** All live session states — the /admin connect dump. */
  listSessionStates(): SessionState[] {
    return [...this.engines.values()].map((e) => e.sessionState());
  }

  /** All live sessions' running events — the /admin connect dump. */
  listSessionRuns(): SessionRuns[] {
    return [...this.engines.values()].map((e) => e.sessionRuns());
  }

  isLive(sessionId: string): boolean {
    return this.engines.has(sessionId);
  }

  private buildEngine(row: Session, timeLimitMs: number | null): SessionEngine {
    return new SessionEngine(row, timeLimitMs, {
      prisma: this.prisma,
      logs: this.logs,
      resolver: this.resolver,
      hints: this.hints,
      transport: () => this.transport,
      onEnded: async (sessionId) => {
        this.engines.delete(sessionId);
        try {
          await this.prisma.sessionDeviceCode.deleteMany({
            where: { sessionId },
          });
        } catch (err) {
          // SessionsService.end() retries this on the REST path; don't let a
          // cleanup failure turn a finished end() into an error.
          this.logger.error(
            `Failed to free device codes for session ${sessionId}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      },
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
    return /Cannot (start|pause|resume)/.test(err.message)
      ? new ConflictException(err.message)
      : new BadRequestException(err.message);
  }
  return err;
}
