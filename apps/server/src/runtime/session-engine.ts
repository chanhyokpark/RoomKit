import { EventEmitter } from 'node:events';
import type { Prisma, Session } from '@prisma/client';
import {
  assetDataSchemas,
  type Command,
  type EventData,
  type JsonValue,
  type PlaybackProgress,
  type SequenceEntry,
  type SessionLogEntry,
  type SessionState,
  type SessionStateValue,
  type TimerState,
  type WireCommand,
} from '@roomkit/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { LogsService } from '../logs/logs.service';
import { CommandResolver, ResolutionError } from './command-resolver';
import { CountdownTimer } from './countdown-timer';
import { runEval } from './eval-sandbox';
import type { RuntimeTransport } from './runtime-transport';

export const ACK_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
export const CALL_EVENT_DEPTH_LIMIT = 8;

/** Thrown into runs when the session ends. */
class RunAbortedError extends Error {
  constructor() {
    super('Session ended');
  }
}

/** Engine-level precondition failures; mapped to HTTP errors by the service. */
export class EngineStateError extends Error {}

interface ParsedEvent {
  id: string;
  name: string;
  data: EventData;
}

export interface EngineDeps {
  prisma: PrismaService;
  logs: LogsService;
  resolver: CommandResolver;
  transport: () => RuntimeTransport;
}

/**
 * In-memory authority for one live session. All live-state mutations flow
 * through here; DB writes are serialized on a per-session promise chain so
 * the persisted row converges on the in-memory state.
 */
export class SessionEngine {
  readonly id: string;
  readonly themeId: string;
  readonly mode: 'test' | 'production';

  private phaseId: string | null;
  private state: SessionStateValue;
  private vars: Record<string, JsonValue>;
  private readonly timeLimitMs: number | null;

  private readonly timer = new CountdownTimer(() => void this.expireTimer());
  /** Remaining ms while the timer is not armed (paused); null otherwise. */
  private timerRemainingStored: number | null = null;
  private timerExpired = false;
  /** Timer paused via adjustTimer (independent of session pause). */
  private timerUserPaused = false;

  private readonly emitter = new EventEmitter();
  private readonly abort = new AbortController();
  private gatePromise: Promise<void> = Promise.resolve();
  private gateRelease: (() => void) | null = null;

  private readonly runCounts = new Map<string, number>();
  private readonly pendingAcks = new Map<
    string,
    { resolve: (status: 'done' | 'failed' | 'ended') => void; timeout: NodeJS.Timeout }
  >();
  private readonly unacked = new Map<string, Map<string, WireCommand>>();
  private readonly progressRelays = new Map<
    string,
    { toDeviceId: string; toCommandId: string }
  >();

  private persistChain: Promise<void> = Promise.resolve();
  private logChain: Promise<void> = Promise.resolve();

  constructor(
    row: Session,
    timeLimitMs: number | null,
    private readonly deps: EngineDeps,
  ) {
    this.id = row.id;
    this.themeId = row.themeId;
    this.mode = row.mode;
    this.phaseId = row.phaseId;
    this.state = row.state === 'ended' ? 'ended' : row.state;
    this.vars = (row.vars ?? {}) as Record<string, JsonValue>;
    this.timeLimitMs = timeLimitMs;
    this.emitter.setMaxListeners(0);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Fresh session: arm the timer, broadcast, fire the session:start hook. */
  start(): void {
    if (this.timeLimitMs !== null) {
      this.timer.arm(this.timeLimitMs);
      this.persistTimer();
    }
    void this.log('info', 'session', 'Session started');
    this.broadcastState();
    this.fireSystemEvents('session:start');
  }

  /** Restarted server: restore timer/pause state, do NOT re-fire session:start. */
  recover(row: Session): void {
    if (row.state === 'paused') this.closeGate();
    if (this.timeLimitMs !== null) {
      if (row.timerEndsAt) {
        const remaining = row.timerEndsAt.getTime() - Date.now();
        if (remaining <= 0) {
          void this.expireTimer();
        } else {
          this.timer.arm(remaining);
        }
      } else if (row.timerRemainingMs !== null) {
        if (row.timerRemainingMs === 0) {
          this.timerExpired = true;
        } else {
          this.timerRemainingStored = row.timerRemainingMs;
          // A stored remainder on a *running* session means the timer was
          // paused independently via adjustTimer.
          this.timerUserPaused = row.state === 'running';
        }
      }
    }
    void this.log('warn', 'session', 'Runtime restarted; in-flight sequences were lost');
    this.broadcastState();
  }

  pause(): void {
    if (this.state !== 'running') {
      throw new EngineStateError(`Cannot pause a ${this.state} session`);
    }
    this.state = 'paused';
    this.closeGate();
    this.emitter.emit('pause');
    if (this.timer.armed) {
      this.timerRemainingStored = this.timer.disarm();
      this.persistTimer();
    }
    this.queuePersist({ state: 'paused' });
    void this.log('info', 'session', 'Session paused');
    this.broadcastState();
  }

  resume(): void {
    if (this.state !== 'paused') {
      throw new EngineStateError(`Cannot resume a ${this.state} session`);
    }
    this.state = 'running';
    if (
      !this.timerUserPaused &&
      !this.timerExpired &&
      this.timerRemainingStored !== null
    ) {
      this.timer.arm(this.timerRemainingStored);
      this.timerRemainingStored = null;
      this.persistTimer();
    }
    this.queuePersist({ state: 'running' });
    this.openGate();
    void this.log('info', 'session', 'Session resumed');
    this.broadcastState();
  }

  async end(): Promise<void> {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.timer.disarm();
    this.abort.abort();
    this.emitter.emit('end');
    for (const [commandId, pending] of this.pendingAcks) {
      clearTimeout(pending.timeout);
      pending.resolve('ended');
      this.pendingAcks.delete(commandId);
    }
    this.unacked.clear();
    this.progressRelays.clear();
    this.openGate();
    this.queuePersist({ state: 'ended', endedAt: new Date() });
    await this.log('info', 'session', 'Session ended');
    this.broadcastState();
    await this.persistChain;
  }

  // ── timer ────────────────────────────────────────────────────────────────

  adjustTimer(adjustment: { deltaMs: number } | { action: 'pause' | 'resume' }): void {
    if (this.timeLimitMs === null) {
      throw new EngineStateError('Theme has no timer');
    }
    if (this.timerExpired) {
      throw new EngineStateError('Timer already expired');
    }
    if ('deltaMs' in adjustment) {
      if (this.timer.armed) {
        const remaining = (this.timer.remainingMs ?? 0) + adjustment.deltaMs;
        if (remaining <= 0) {
          this.timer.disarm();
          void this.expireTimer();
          return;
        }
        this.timer.arm(remaining);
      } else if (this.timerRemainingStored !== null) {
        this.timerRemainingStored = Math.max(
          1,
          this.timerRemainingStored + adjustment.deltaMs,
        );
      }
      void this.log('info', 'timer', `Timer adjusted by ${adjustment.deltaMs}ms`);
    } else if (adjustment.action === 'pause') {
      this.timerUserPaused = true;
      if (this.timer.armed) {
        this.timerRemainingStored = this.timer.disarm();
      }
      void this.log('info', 'timer', 'Timer paused');
    } else {
      this.timerUserPaused = false;
      if (this.state === 'running' && this.timerRemainingStored !== null) {
        this.timer.arm(this.timerRemainingStored);
        this.timerRemainingStored = null;
      }
      void this.log('info', 'timer', 'Timer resumed');
    }
    this.persistTimer();
    this.broadcastState();
  }

  private async expireTimer(): Promise<void> {
    if (this.timerExpired || this.state === 'ended') return;
    this.timerExpired = true;
    this.timerRemainingStored = null;
    this.queuePersist({ timerEndsAt: null, timerRemainingMs: 0 });
    await this.log('info', 'timer', 'Timer expired');
    this.broadcastState();
    this.fireSystemEvents('timer:expired');
  }

  private persistTimer(): void {
    this.queuePersist({
      timerEndsAt: this.timer.endsAt,
      timerRemainingMs: this.timerExpired ? 0 : this.timerRemainingStored,
    });
  }

  // ── triggers & events ────────────────────────────────────────────────────

  /** Device (or eval) trigger by name; fire-and-forget for all matching events. */
  async handleTrigger(name: string, source: string): Promise<void> {
    if (this.state === 'ended') return;
    void this.log('info', 'trigger', `Trigger "${name}" from ${source}`);
    const events = await this.findEvents(
      (e) => e.data.triggerKind === 'device' && e.data.triggerName === name,
    );
    if (events.length === 0) {
      void this.log('warn', 'trigger', `No event listens to trigger "${name}"`);
      return;
    }
    for (const event of events) {
      const rejection = this.admit(event);
      if (rejection) {
        void this.log('info', 'trigger', `Event "${event.name}" not run: ${rejection}`);
        continue;
      }
      void this.executeRun(event, 0);
    }
  }

  /** REST manual trigger; admission failures surface as errors to the admin. */
  async manualTrigger(eventId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    if (!event.data.manualTriggerable) {
      throw new EngineStateError('Event is not manually triggerable');
    }
    const rejection = this.admit(event);
    if (rejection) throw new EngineStateError(rejection);
    void this.log('info', 'trigger', `Event "${event.name}" triggered manually`);
    void this.executeRun(event, 0);
  }

  /** REST forced phase switch. */
  async forceSwitchPhase(phaseId: string): Promise<void> {
    await this.switchPhase(phaseId, 'admin');
  }

  async resetAllDevices(): Promise<void> {
    await this.dispatchCommand({ type: 'resetAllDevices' });
    void this.log('info', 'device', 'All devices reset');
  }

  /**
   * System hook events (session:start, timer:expired, phase:enter/leave).
   * `phaseScope` overrides the phase guard for phase hooks: an enter/leave
   * hook belongs to the phase being entered/left (or is common).
   */
  private fireSystemEvents(name: string, phaseScope?: string | null): Promise<void[]> {
    const scope = phaseScope === undefined ? this.phaseId : phaseScope;
    const promise = (async () => {
      const events = await this.findEvents(
        (e) =>
          e.data.triggerKind === 'system' &&
          e.data.triggerName === name &&
          (e.data.phaseId === null || e.data.phaseId === scope),
      );
      return Promise.all(
        events.map((event) => {
          const rejection = this.admit(event, { bypassPhaseGuard: true });
          if (rejection) {
            void this.log('info', 'event', `Hook "${event.name}" not run: ${rejection}`);
            return Promise.resolve();
          }
          return this.executeRun(event, 0);
        }),
      );
    })();
    promise.catch(() => {});
    return promise;
  }

  /** Returns a human-readable rejection reason, or null when admitted. */
  private admit(
    event: ParsedEvent,
    opts: { bypassPhaseGuard?: boolean } = {},
  ): string | null {
    if (this.state === 'ended') return 'session ended';
    if (
      !opts.bypassPhaseGuard &&
      event.data.phaseId !== null &&
      event.data.phaseId !== this.phaseId
    ) {
      return 'out of phase';
    }
    if ((this.runCounts.get(event.id) ?? 0) > 0 && !event.data.allowReentry) {
      return 'already running (re-entry not allowed)';
    }
    return null;
  }

  private async executeRun(event: ParsedEvent, depth: number): Promise<void> {
    this.runCounts.set(event.id, (this.runCounts.get(event.id) ?? 0) + 1);
    void this.log('info', 'event', `Event "${event.name}" started`, {
      eventId: event.id,
    });
    try {
      await this.runSequence(event, depth);
      void this.log('info', 'event', `Event "${event.name}" finished`, {
        eventId: event.id,
      });
    } catch (err) {
      if (err instanceof RunAbortedError) {
        void this.log('warn', 'event', `Event "${event.name}" aborted (session ended)`);
      } else {
        void this.log('error', 'event', `Event "${event.name}" failed: ${msg(err)}`, {
          eventId: event.id,
        });
      }
    } finally {
      const count = (this.runCounts.get(event.id) ?? 1) - 1;
      if (count <= 0) this.runCounts.delete(event.id);
      else this.runCounts.set(event.id, count);
    }
  }

  // ── sequence execution ───────────────────────────────────────────────────

  private async runSequence(event: ParsedEvent, depth: number): Promise<void> {
    for (const entry of event.data.sequence) {
      await this.awaitGate();
      const stop = await this.runCommand(entry, depth);
      if (stop) return;
    }
  }

  /** Returns true when the sequence must stop (eval returned false / failed). */
  private async runCommand(entry: SequenceEntry, depth: number): Promise<boolean> {
    switch (entry.type) {
      case 'wait':
        await this.pausableSleep(entry.durationMs);
        return false;
      case 'eval':
        return this.runEvalCommand(entry.code);
      case 'switchPhase':
        await this.switchPhase(entry.phaseId, 'sequence');
        return false;
      case 'callEvent':
        await this.callEvent(entry.eventId, depth);
        return false;
      case 'adjustTimer':
        try {
          this.adjustTimer(entry.adjustment);
        } catch (err) {
          void this.log('warn', 'timer', `adjustTimer skipped: ${msg(err)}`);
        }
        return false;
      default:
        await this.dispatchCommand(entry);
        return false;
    }
  }

  private async dispatchCommand(cmd: Command): Promise<void> {
    let resolution;
    try {
      resolution = await this.deps.resolver.resolve(this.themeId, cmd);
    } catch (err) {
      if (err instanceof ResolutionError) {
        void this.log('error', 'command', `${cmd.type} skipped: ${err.message}`);
        return;
      }
      throw err;
    }
    if (resolution.relay) {
      this.progressRelays.set(resolution.relay.fromCommandId, {
        toDeviceId: resolution.relay.toDeviceId,
        toCommandId: resolution.relay.toCommandId,
      });
    }
    const online = new Map<string, boolean>();
    for (const delivery of resolution.deliveries) {
      online.set(delivery.wire.id, this.sendWire(delivery.deviceId, delivery.wire, cmd.type));
    }
    if (resolution.awaitAckOf) {
      const { commandId, deviceId } = resolution.awaitAckOf;
      if (!online.get(commandId)) return; // offline: logged, continue immediately
      const status = await this.waitForAck(commandId);
      this.checkAborted();
      if (status === 'timeout') {
        void this.log('warn', 'command', `${cmd.type} ack timed out (device ${deviceId})`);
      } else if (status === 'failed') {
        void this.log('warn', 'command', `${cmd.type} reported failed by device ${deviceId}`);
      }
    }
  }

  private sendWire(deviceId: string, wire: WireCommand, label: string): boolean {
    const online = this.deps.transport().sendCommand(this.id, deviceId, wire);
    if (online) {
      let perDevice = this.unacked.get(deviceId);
      if (!perDevice) this.unacked.set(deviceId, (perDevice = new Map()));
      perDevice.set(wire.id, wire);
      void this.log('info', 'command', `${label} sent to device`, {
        deviceId,
        commandId: wire.id,
        wireType: wire.type,
      });
    } else {
      void this.log('warn', 'command', `${label} failed: device offline`, {
        deviceId,
        commandId: wire.id,
        wireType: wire.type,
      });
    }
    return online;
  }

  private waitForAck(commandId: string): Promise<'done' | 'failed' | 'ended' | 'timeout'> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(commandId);
        resolve('timeout');
      }, ACK_WAIT_TIMEOUT_MS);
      this.pendingAcks.set(commandId, { resolve, timeout });
    });
  }

  private async callEvent(eventId: string, depth: number): Promise<void> {
    if (depth + 1 > CALL_EVENT_DEPTH_LIMIT) {
      throw new Error(`callEvent depth limit (${CALL_EVENT_DEPTH_LIMIT}) exceeded`);
    }
    const event = await this.getEvent(eventId);
    // Explicit invocation: the phase guard is bypassed (subroutine semantics),
    // the re-entry guard still applies.
    const rejection = this.admit(event, { bypassPhaseGuard: true });
    if (rejection) {
      void this.log('info', 'event', `callEvent "${event.name}" not run: ${rejection}`);
      return;
    }
    await this.executeRun(event, depth + 1);
  }

  private async switchPhase(phaseId: string, source: string): Promise<void> {
    const phase = await this.deps.prisma.asset.findFirst({
      where: { id: phaseId, themeId: this.themeId, kind: 'phase' },
      select: { id: true, name: true },
    });
    if (!phase) {
      throw new EngineStateError('Phase not found in theme');
    }
    if (this.phaseId === phaseId) return;
    const oldPhaseId = this.phaseId;
    // Leave hooks run (and finish) while still in the old phase…
    if (oldPhaseId !== null) {
      await this.fireSystemEvents('phase:leave', oldPhaseId);
      this.checkAborted();
    }
    this.phaseId = phaseId;
    this.queuePersist({ phaseId });
    void this.log('info', 'phase', `Phase switched to "${phase.name}" (${source})`, {
      from: oldPhaseId,
      to: phaseId,
    });
    this.broadcastState();
    // …enter hooks must not block the switching sequence.
    this.fireSystemEvents('phase:enter', phaseId).catch(() => {});
  }

  private async runEvalCommand(code: string): Promise<boolean> {
    let phaseName: string | null = null;
    if (this.phaseId !== null) {
      const phase = await this.deps.prisma.asset.findUnique({
        where: { id: this.phaseId },
        select: { name: true },
      });
      phaseName = phase?.name ?? null;
    }
    let result: unknown;
    try {
      result = runEval(code, {
        vars: this.vars,
        phase: phaseName,
        trigger: (name) => void this.handleTrigger(String(name), 'eval'),
        log: (message) => void this.log('info', 'eval', String(message)),
      });
    } catch (err) {
      // Fail safe: a throwing guard must not let the sequence continue.
      void this.log('error', 'eval', `eval failed: ${msg(err)}`);
      return true;
    }
    this.queuePersist({ vars: this.vars as Prisma.InputJsonValue });
    if (result === false) {
      void this.log('info', 'eval', 'eval returned false; sequence stopped');
      return true;
    }
    return false;
  }

  // ── inbound from gateway ─────────────────────────────────────────────────

  handleAck(deviceId: string, commandId: string, status: 'done' | 'failed'): void {
    this.unacked.get(deviceId)?.delete(commandId);
    this.progressRelays.delete(commandId);
    const pending = this.pendingAcks.get(commandId);
    if (!pending) return; // duplicate or non-awaited ack — fine
    clearTimeout(pending.timeout);
    this.pendingAcks.delete(commandId);
    pending.resolve(status);
  }

  handleProgress(deviceId: string, progress: PlaybackProgress): void {
    const relay = this.progressRelays.get(progress.commandId);
    if (!relay) return;
    this.deps.transport().sendProgress(this.id, relay.toDeviceId, {
      commandId: relay.toCommandId,
      lineIndex: progress.lineIndex,
    });
  }

  /** Redeliver unacked commands (same ids — clients dedupe). */
  onDeviceConnected(deviceId: string): void {
    const perDevice = this.unacked.get(deviceId);
    if (!perDevice) return;
    for (const wire of perDevice.values()) {
      this.deps.transport().sendCommand(this.id, deviceId, wire);
    }
  }

  deviceStatusChanged(deviceId: string, deviceName: string, online: boolean): void {
    void this.log('info', 'device', `Device "${deviceName}" ${online ? 'online' : 'offline'}`, {
      deviceId,
    });
    this.deps.transport().broadcastDeviceStatus({
      sessionId: this.id,
      deviceId,
      deviceName,
      online,
    });
  }

  // ── state & helpers ──────────────────────────────────────────────────────

  get stateValue(): SessionStateValue {
    return this.state;
  }

  /** Resolves when every queued DB write so far has landed. */
  flush(): Promise<void> {
    return this.persistChain;
  }

  /**
   * Releases timers/handles on server shutdown WITHOUT ending the session —
   * the persisted row stays live so the next boot recovers it.
   */
  dispose(): void {
    this.timer.disarm();
    this.abort.abort();
    this.emitter.emit('end');
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timeout);
      pending.resolve('ended');
    }
    this.pendingAcks.clear();
    this.openGate();
  }

  sessionState(): SessionState {
    let timerState: TimerState | null = null;
    let timerRemainingMs: number | null = null;
    if (this.timeLimitMs !== null) {
      if (this.timerExpired) {
        timerState = 'expired';
        timerRemainingMs = 0;
      } else if (this.timer.armed) {
        timerState = 'running';
        timerRemainingMs = this.timer.remainingMs ?? 0;
      } else {
        timerState = 'paused';
        timerRemainingMs = this.timerRemainingStored ?? this.timeLimitMs;
      }
    }
    return {
      sessionId: this.id,
      themeId: this.themeId,
      mode: this.mode,
      phaseId: this.phaseId,
      state: this.state,
      timerState,
      timerRemainingMs,
    };
  }

  private broadcastState(): void {
    this.deps.transport().broadcastSessionState(this.sessionState());
  }

  private log(
    level: 'info' | 'warn' | 'error',
    kind: string,
    message: string,
    data?: JsonValue,
  ): Promise<void> {
    this.logChain = this.logChain.then(async () => {
      try {
        const entry = await this.deps.logs.append(this.id, {
          level,
          kind: kind as SessionLogEntry['kind'],
          message,
          data,
        });
        this.deps.transport().broadcastLog(entry as unknown as SessionLogEntry);
      } catch (err) {
        console.error(`[session ${this.id}] failed to write log:`, err);
      }
    });
    return this.logChain;
  }

  private queuePersist(data: Prisma.SessionUpdateInput): void {
    this.persistChain = this.persistChain.then(async () => {
      try {
        await this.deps.prisma.session.update({ where: { id: this.id }, data });
      } catch (err) {
        console.error(`[session ${this.id}] failed to persist:`, err);
      }
    });
  }

  /** Blocks while paused; throws when the session ended. */
  private async awaitGate(): Promise<void> {
    await this.gatePromise;
    this.checkAborted();
  }

  private checkAborted(): void {
    if (this.abort.signal.aborted) throw new RunAbortedError();
  }

  private closeGate(): void {
    if (this.gateRelease) return;
    this.gatePromise = new Promise((resolve) => {
      this.gateRelease = resolve;
    });
  }

  private openGate(): void {
    this.gateRelease?.();
    this.gateRelease = null;
  }

  /** Sleep that pauses with the session and aborts on end. */
  private async pausableSleep(ms: number): Promise<void> {
    let remaining = ms;
    while (remaining > 0) {
      await this.awaitGate();
      const start = Date.now();
      const outcome = await new Promise<'timeout' | 'pause' | 'end'>((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve('timeout');
        }, remaining);
        const onPause = () => {
          cleanup();
          resolve('pause');
        };
        const onEnd = () => {
          cleanup();
          resolve('end');
        };
        const cleanup = () => {
          clearTimeout(timeout);
          this.emitter.off('pause', onPause);
          this.emitter.off('end', onEnd);
        };
        this.emitter.once('pause', onPause);
        this.emitter.once('end', onEnd);
      });
      if (outcome === 'timeout') return;
      if (outcome === 'end') throw new RunAbortedError();
      remaining -= Date.now() - start;
    }
  }

  private async findEvents(
    predicate: (event: ParsedEvent) => boolean,
  ): Promise<ParsedEvent[]> {
    const rows = await this.deps.prisma.asset.findMany({
      where: { themeId: this.themeId, kind: 'event' },
    });
    const events: ParsedEvent[] = [];
    for (const row of rows) {
      const parsed = assetDataSchemas.event.safeParse(row.data);
      if (!parsed.success) {
        void this.log('error', 'event', `Event "${row.name}" has invalid data; skipped`);
        continue;
      }
      const event = { id: row.id, name: row.name, data: parsed.data };
      if (predicate(event)) events.push(event);
    }
    return events;
  }

  private async getEvent(eventId: string): Promise<ParsedEvent> {
    const row = await this.deps.prisma.asset.findFirst({
      where: { id: eventId, themeId: this.themeId, kind: 'event' },
    });
    if (!row) throw new EngineStateError('Event not found in theme');
    const parsed = assetDataSchemas.event.safeParse(row.data);
    if (!parsed.success) throw new EngineStateError('Event has invalid data');
    return { id: row.id, name: row.name, data: parsed.data };
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
