import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Prisma, Session } from '@prisma/client';
import {
  assetDataSchemas,
  type Command,
  type EventData,
  type HintError,
  type HintNext,
  type HintShow,
  type JsonValue,
  type PlaybackProgress,
  type RunningEvent,
  type SequenceEntry,
  type SessionLogEntry,
  type SessionRuns,
  type SessionState,
  type SessionStateValue,
  type TimerState,
  type Verdict,
  type WireCommand,
} from '@roomkit/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { LogsService } from '../logs/logs.service';
import { CommandResolver, ResolutionError } from './command-resolver';
import { CountdownTimer } from './countdown-timer';
import { runEval } from './eval-sandbox';
import type { HintService, ResolvedHint } from './hint.service';
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

/** Engine action queued by an eval script; runs after the script returns. */
type EvalAction =
  | { kind: 'switchPhase'; name: string }
  | { kind: 'notify'; message: string }
  | { kind: 'adjustTimer'; arg: number | 'pause' | 'resume' }
  | { kind: 'endTheme'; verdict: Verdict };

export interface EngineDeps {
  prisma: PrismaService;
  logs: LogsService;
  resolver: CommandResolver;
  hints: HintService;
  transport: () => RuntimeTransport;
  /**
   * Post-end cleanup owned by the registry (engine removal, device-code
   * release). Invoked on every end path, including engine-initiated ones
   * (endTheme) that never pass through SessionRuntimeService.end().
   */
  onEnded: (sessionId: string) => Promise<void>;
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
  private verdict: Verdict | null;
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
  /** In-flight event runs, keyed by run id — mirrored to /admin on every step. */
  private readonly activeRuns = new Map<string, RunningEvent>();
  private readonly pendingAcks = new Map<
    string,
    {
      resolve: (status: 'done' | 'failed' | 'ended') => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private readonly unacked = new Map<string, Map<string, WireCommand>>();
  private readonly progressRelays = new Map<
    string,
    { toDeviceId: string; toCommandId: string; lineCount: number }
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
    this.verdict = row.verdict;
    this.timeLimitMs = timeLimitMs;
    this.emitter.setMaxListeners(0);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Fresh session: announce it and wait for an explicit start. Devices may
   * already connect (the operator checks online status before starting).
   */
  attach(): void {
    void this.log('info', 'session', 'Session created');
    this.broadcastState();
  }

  /** Explicit start: arm the timer, fire the session:start hook. */
  start(): void {
    if (this.state !== 'created') {
      throw new EngineStateError(`Cannot start a ${this.state} session`);
    }
    this.state = 'running';
    if (this.timeLimitMs !== null) {
      this.timer.arm(this.timeLimitMs);
      this.persistTimer();
    }
    this.queuePersist({ state: 'running', startedAt: new Date() });
    void this.log('info', 'session', 'Session started');
    this.broadcastState();
    this.fireSystemEvents('session:start');
    // Starting the session enters the initial phase — its enter hooks fire
    // here, since no switchPhase ever targets the first phase.
    if (this.phaseId !== null) {
      this.fireSystemEvents('phase:enter', this.phaseId);
    }
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
    void this.log(
      'warn',
      'session',
      'Runtime restarted; in-flight sequences were lost',
    );
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
    if (this.activeRuns.size > 0) {
      this.activeRuns.clear();
      this.broadcastRuns();
    }
    this.openGate();
    this.queuePersist({ state: 'ended', endedAt: new Date() });
    await this.log('info', 'session', 'Session ended');
    this.broadcastState();
    await this.persistChain;
    await this.deps.onEnded(this.id);
  }

  // ── timer ────────────────────────────────────────────────────────────────

  adjustTimer(
    adjustment: { deltaMs: number } | { action: 'pause' | 'resume' },
  ): void {
    if (this.timeLimitMs === null) {
      throw new EngineStateError('Theme has no timer');
    }
    if (this.state === 'created') {
      throw new EngineStateError('Session not started');
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
      void this.log(
        'info',
        'timer',
        `Timer adjusted by ${adjustment.deltaMs}ms`,
      );
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
    // Callers void this promise, so a rejection (e.g. a transient DB error in
    // findEvents) would otherwise become an unhandled rejection and can kill
    // the process mid-game.
    try {
      await this.handleTriggerInner(name, source);
    } catch (err) {
      void this.log(
        'error',
        'trigger',
        `Trigger "${name}" from ${source} failed: ${String(err)}`,
      );
    }
  }

  private async handleTriggerInner(
    name: string,
    source: string,
  ): Promise<void> {
    if (this.state === 'ended') return;
    if (this.state === 'created') {
      void this.log(
        'info',
        'trigger',
        `Trigger "${name}" from ${source} ignored (session not started)`,
      );
      return;
    }
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
        void this.log(
          'info',
          'trigger',
          `Event "${event.name}" not run: ${rejection}`,
        );
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
    void this.log(
      'info',
      'trigger',
      `Event "${event.name}" triggered manually`,
    );
    void this.executeRun(event, 0);
  }

  /** REST forced phase switch. */
  async forceSwitchPhase(phaseId: string): Promise<void> {
    if (this.state === 'created') {
      throw new EngineStateError('Session not started');
    }
    await this.switchPhase(phaseId, 'admin');
  }

  /** REST forced re-entry of the current phase: leave hooks, then enter hooks. */
  async restartCurrentPhase(): Promise<void> {
    if (this.state === 'created') {
      throw new EngineStateError('Session not started');
    }
    if (this.phaseId === null) {
      throw new EngineStateError('Session has no phase');
    }
    const phaseId = this.phaseId;
    const phase = await this.deps.prisma.asset.findFirst({
      where: { id: phaseId, themeId: this.themeId, kind: 'phase' },
      select: { name: true },
    });
    await this.fireSystemEvents('phase:leave', phaseId);
    this.checkAborted();
    void this.log(
      'info',
      'phase',
      `Phase "${phase?.name ?? phaseId}" restarted (admin)`,
      { phaseId },
    );
    this.fireSystemEvents('phase:enter', phaseId).catch(() => {});
  }

  async resetAllDevices(): Promise<void> {
    await this.dispatchCommand({ type: 'resetAllDevices' });
    void this.log('info', 'device', 'All devices reset');
  }

  // ── hints ────────────────────────────────────────────────────────────────

  /** Hint device entered a code; returns the payload the gateway should emit. */
  async handleHintSubmit(
    deviceId: string,
    code: string,
  ): Promise<HintShow | HintError> {
    const gate = await this.hintGate(deviceId);
    if (gate) return gate;
    const hint = await this.deps.hints.findByCode(this.themeId, code);
    if (!hint) {
      void this.log('warn', 'hint', `Wrong hint code "${code}" entered`, {
        code,
      });
      return { reason: 'unknown_code', code };
    }
    return this.showHint(hint, 0, 'code entry');
  }

  /** Stateless step advance: the device asks for the exact step it wants. */
  async handleHintNext(
    deviceId: string,
    req: HintNext,
  ): Promise<HintShow | HintError> {
    const gate = await this.hintGate(deviceId);
    if (gate) return gate;
    const hint = await this.deps.hints.findById(this.themeId, req.hintId);
    if (!hint) return { reason: 'unknown_hint', hintId: req.hintId };
    if (req.step >= hint.data.steps.length) {
      return { reason: 'invalid_step', hintId: req.hintId };
    }
    return this.showHint(hint, req.step, 'next step');
  }

  /** Admin push to every hint device. Allowed while paused (operator judgment). */
  async pushHint(hintId: string, step: number): Promise<void> {
    const hint = await this.deps.hints.findById(this.themeId, hintId);
    if (!hint) throw new EngineStateError('Hint not found in theme');
    if (step >= hint.data.steps.length) {
      throw new EngineStateError(
        `Hint has ${hint.data.steps.length} step(s); step ${step} is out of range`,
      );
    }
    const deviceIds = await this.deps.hints.hintDeviceIds(this.themeId);
    if (deviceIds.length === 0) {
      throw new EngineStateError('Theme has no hint device');
    }
    const show = await this.deps.hints.buildShow(hint, step);
    let delivered = 0;
    for (const deviceId of deviceIds) {
      if (this.deps.transport().sendHint(this.id, deviceId, show)) delivered++;
    }
    if (delivered === 0) {
      // Mirrors offline-command semantics: warn and continue, not an error.
      void this.log(
        'warn',
        'hint',
        `Hint "${hint.code}" pushed by admin but no hint device is online`,
        { hintId, step },
      );
    } else {
      void this.log(
        'info',
        'hint',
        `Hint "${hint.code}" step ${step + 1}/${show.stepCount} pushed by admin`,
        { hintId, step },
      );
    }
  }

  private async hintGate(deviceId: string): Promise<HintError | null> {
    if (this.state !== 'running') return { reason: 'session_not_running' };
    if (!(await this.deps.hints.isHintDevice(this.themeId, deviceId))) {
      void this.log(
        'warn',
        'hint',
        'Hint request from a non-hint device ignored',
        {
          deviceId,
        },
      );
      return { reason: 'not_hint_device' };
    }
    return null;
  }

  private async showHint(
    hint: ResolvedHint,
    step: number,
    source: string,
  ): Promise<HintShow> {
    const show = await this.deps.hints.buildShow(hint, step);
    void this.log(
      'info',
      'hint',
      `Hint "${hint.code}" step ${step + 1}/${show.stepCount} shown (${source})`,
      { hintId: hint.id, code: hint.code, step },
    );
    return show;
  }

  /**
   * System hook events (session:start, timer:expired, phase:enter/leave).
   * `phaseScope` overrides the phase guard for phase hooks: an enter/leave
   * hook belongs to the phase being entered/left (or is common).
   */
  private fireSystemEvents(
    name: string,
    phaseScope?: string | null,
  ): Promise<void[]> {
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
            void this.log(
              'info',
              'event',
              `Hook "${event.name}" not run: ${rejection}`,
            );
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
    if (this.state === 'created') return 'session not started';
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
    const run: RunningEvent = {
      runId: randomUUID(),
      eventId: event.id,
      eventName: event.name,
      startedAt: Date.now(),
      entryIndex: 0,
      entryCount: event.data.sequence.length,
      commandType: event.data.sequence[0]?.type ?? null,
    };
    this.activeRuns.set(run.runId, run);
    this.broadcastRuns();
    void this.log('info', 'event', `Event "${event.name}" started`, {
      eventId: event.id,
    });
    try {
      await this.runSequence(event, depth, run);
      void this.log('info', 'event', `Event "${event.name}" finished`, {
        eventId: event.id,
      });
    } catch (err) {
      if (err instanceof RunAbortedError) {
        void this.log(
          'warn',
          'event',
          `Event "${event.name}" aborted (session ended)`,
        );
      } else {
        void this.log(
          'error',
          'event',
          `Event "${event.name}" failed: ${msg(err)}`,
          {
            eventId: event.id,
          },
        );
      }
    } finally {
      const count = (this.runCounts.get(event.id) ?? 1) - 1;
      if (count <= 0) this.runCounts.delete(event.id);
      else this.runCounts.set(event.id, count);
      this.activeRuns.delete(run.runId);
      this.broadcastRuns();
    }
  }

  // ── sequence execution ───────────────────────────────────────────────────

  private async runSequence(
    event: ParsedEvent,
    depth: number,
    run: RunningEvent,
  ): Promise<void> {
    for (const [index, entry] of event.data.sequence.entries()) {
      run.entryIndex = index;
      run.commandType = entry.type;
      this.broadcastRuns();
      await this.awaitGate();
      const stop = await this.runCommand(entry, depth);
      if (stop) return;
    }
  }

  /** Returns true when the sequence must stop (eval returned false / failed). */
  private async runCommand(
    entry: SequenceEntry,
    depth: number,
  ): Promise<boolean> {
    switch (entry.type) {
      case 'wait':
        await this.pausableSleep(entry.durationMs);
        return false;
      case 'eval':
        return this.runEvalCommand(entry.code);
      case 'switchPhase':
        if (entry.phaseId === null) {
          void this.log(
            'error',
            'command',
            'switchPhase skipped: phase reference not set',
          );
          return false;
        }
        await this.switchPhase(entry.phaseId, 'sequence');
        return false;
      case 'callEvent':
        if (entry.eventId === null) {
          void this.log(
            'error',
            'command',
            'callEvent skipped: event reference not set',
          );
          return false;
        }
        await this.callEvent(entry.eventId, depth, entry.waitUntilFinish);
        return false;
      case 'adjustTimer':
        try {
          this.adjustTimer(entry.adjustment);
        } catch (err) {
          void this.log('warn', 'timer', `adjustTimer skipped: ${msg(err)}`);
        }
        return false;
      case 'endTheme':
        await this.endTheme(entry.verdict);
        return true; // session is over — nothing after this entry may run
      case 'notify': {
        const message = entry.message.trim();
        if (message === '') {
          void this.log('warn', 'command', 'notify skipped: message not set');
          return false;
        }
        this.deps
          .transport()
          .broadcastNotification({ sessionId: this.id, message });
        void this.log('info', 'command', `Operator notification: ${message}`);
        return false;
      }
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
        void this.log(
          'error',
          'command',
          `${cmd.type} skipped: ${err.message}`,
        );
        return;
      }
      throw err;
    }
    if (resolution.relay) {
      this.progressRelays.set(resolution.relay.fromCommandId, {
        toDeviceId: resolution.relay.toDeviceId,
        toCommandId: resolution.relay.toCommandId,
        lineCount: resolution.relay.lineCount,
      });
    }
    const online = new Map<string, boolean>();
    for (const delivery of resolution.deliveries) {
      online.set(
        delivery.wire.id,
        this.sendWire(delivery.deviceId, delivery.wire, cmd.type),
      );
    }
    if (resolution.awaitAckOf) {
      const { commandId, deviceId } = resolution.awaitAckOf;
      if (!online.get(commandId)) return; // offline: logged, continue immediately
      const status = await this.waitForAck(commandId);
      this.checkAborted();
      if (status === 'timeout') {
        void this.log(
          'warn',
          'command',
          `${cmd.type} ack timed out (device ${deviceId})`,
        );
      } else if (status === 'failed') {
        void this.log(
          'warn',
          'command',
          `${cmd.type} reported failed by device ${deviceId}`,
        );
      }
    }
  }

  private sendWire(
    deviceId: string,
    wire: WireCommand,
    label: string,
  ): boolean {
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

  private waitForAck(
    commandId: string,
  ): Promise<'done' | 'failed' | 'ended' | 'timeout'> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(commandId);
        resolve('timeout');
      }, ACK_WAIT_TIMEOUT_MS);
      this.pendingAcks.set(commandId, { resolve, timeout });
    });
  }

  private async callEvent(
    eventId: string,
    depth: number,
    waitUntilFinish: boolean,
  ): Promise<void> {
    if (depth + 1 > CALL_EVENT_DEPTH_LIMIT) {
      throw new Error(
        `callEvent depth limit (${CALL_EVENT_DEPTH_LIMIT}) exceeded`,
      );
    }
    const event = await this.getEvent(eventId);
    // Explicit invocation: the phase guard is bypassed (subroutine semantics),
    // the re-entry guard still applies.
    const rejection = this.admit(event, { bypassPhaseGuard: true });
    if (rejection) {
      void this.log(
        'info',
        'event',
        `callEvent "${event.name}" not run: ${rejection}`,
      );
      return;
    }
    // executeRun never rejects (it catches internally), so fire-and-forget
    // needs no .catch — same as handleTriggerInner. Depth still applies.
    if (waitUntilFinish) await this.executeRun(event, depth + 1);
    else void this.executeRun(event, depth + 1);
  }

  /**
   * Game over (endTheme command): resets every device, records the verdict
   * for the operation screen, then ends the session.
   */
  private async endTheme(verdict: Verdict): Promise<void> {
    await this.dispatchCommand({ type: 'resetAllDevices' });
    this.verdict = verdict;
    this.queuePersist({ verdict });
    void this.log(
      'info',
      'session',
      `Theme ended with verdict "${verdict}"; all devices reset`,
      { verdict },
    );
    await this.end();
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
    void this.log(
      'info',
      'phase',
      `Phase switched to "${phase.name}" (${source})`,
      {
        from: oldPhaseId,
        to: phaseId,
      },
    );
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
    // The script is synchronous in the vm; engine actions invoked through ctx
    // are queued and run after it returns, in call order. A throw discards
    // the queue (nothing the script asked for happens on failure).
    const actions: EvalAction[] = [];
    let result: unknown;
    try {
      result = runEval(code, {
        vars: this.vars,
        phase: phaseName,
        trigger: (name) => void this.handleTrigger(String(name), 'eval'),
        log: (message) => void this.log('info', 'eval', String(message)),
        switchPhase: (name) =>
          void actions.push({ kind: 'switchPhase', name: String(name) }),
        notify: (message) =>
          void actions.push({ kind: 'notify', message: String(message) }),
        adjustTimer: (arg) => {
          if (arg !== 'pause' && arg !== 'resume' && !Number.isInteger(arg)) {
            throw new TypeError(
              "ctx.adjustTimer expects an integer deltaMs, 'pause', or 'resume'",
            );
          }
          actions.push({ kind: 'adjustTimer', arg });
        },
        endTheme: (verdict) => {
          if (verdict !== 'success' && verdict !== 'fail') {
            throw new TypeError("ctx.endTheme expects 'success' or 'fail'");
          }
          actions.push({ kind: 'endTheme', verdict });
        },
      });
    } catch (err) {
      // Fail safe: a throwing guard must not let the sequence continue.
      void this.log('error', 'eval', `eval failed: ${msg(err)}`);
      return true;
    }
    this.queuePersist({ vars: this.vars });
    // Queued actions run even when the script returns false — they were
    // invoked before the return, which is the least surprising rule.
    if (await this.runEvalActions(actions)) return true;
    if (result === false) {
      void this.log('info', 'eval', 'eval returned false; sequence stopped');
      return true;
    }
    return false;
  }

  /** Returns true when the sequence must stop (an action ended the session). */
  private async runEvalActions(actions: EvalAction[]): Promise<boolean> {
    for (const action of actions) {
      switch (action.kind) {
        case 'switchPhase': {
          const phase = await this.deps.prisma.asset.findFirst({
            where: { themeId: this.themeId, kind: 'phase', name: action.name },
            select: { id: true },
          });
          if (!phase) {
            void this.log(
              'warn',
              'eval',
              `ctx.switchPhase skipped: phase "${action.name}" not found`,
            );
            break;
          }
          await this.switchPhase(phase.id, 'eval');
          break;
        }
        case 'notify': {
          const message = action.message.trim();
          if (message === '') {
            void this.log('warn', 'eval', 'ctx.notify skipped: empty message');
            break;
          }
          this.deps
            .transport()
            .broadcastNotification({ sessionId: this.id, message });
          void this.log('info', 'eval', `Operator notification: ${message}`);
          break;
        }
        case 'adjustTimer':
          try {
            this.adjustTimer(
              typeof action.arg === 'number'
                ? { deltaMs: action.arg }
                : { action: action.arg },
            );
          } catch (err) {
            void this.log(
              'warn',
              'timer',
              `ctx.adjustTimer skipped: ${msg(err)}`,
            );
          }
          break;
        case 'endTheme':
          await this.endTheme(action.verdict);
          return true; // session is over — remaining actions are skipped
      }
    }
    return false;
  }

  // ── inbound from gateway ─────────────────────────────────────────────────

  handleAck(
    deviceId: string,
    commandId: string,
    status: 'done' | 'failed',
  ): void {
    this.unacked.get(deviceId)?.delete(commandId);
    // Speaker acked a split dialogue: tell the screen it ended with an
    // out-of-range lineIndex sentinel so it can clear the subtitle.
    const relay = this.progressRelays.get(commandId);
    if (relay) {
      this.progressRelays.delete(commandId);
      this.deps.transport().sendProgress(this.id, relay.toDeviceId, {
        commandId: relay.toCommandId,
        lineIndex: relay.lineCount,
      });
    }
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

  deviceStatusChanged(
    deviceId: string,
    deviceName: string,
    online: boolean,
  ): void {
    void this.log(
      'info',
      'device',
      `Device "${deviceName}" ${online ? 'online' : 'offline'}`,
      {
        deviceId,
      },
    );
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
      verdict: this.verdict,
      timerState,
      timerRemainingMs,
    };
  }

  /** Snapshot of in-flight event runs — the /admin connect dump and broadcasts. */
  sessionRuns(): SessionRuns {
    return { sessionId: this.id, runs: [...this.activeRuns.values()] };
  }

  private broadcastState(): void {
    this.deps.transport().broadcastSessionState(this.sessionState());
  }

  private broadcastRuns(): void {
    this.deps.transport().broadcastSessionRuns(this.sessionRuns());
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
      const outcome = await new Promise<'timeout' | 'pause' | 'end'>(
        (resolve) => {
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
        },
      );
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
        void this.log(
          'error',
          'event',
          `Event "${row.name}" has invalid data; skipped`,
        );
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
