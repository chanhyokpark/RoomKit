import { randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  assetDataSchemas,
  DeviceDataSchema,
  PhaseDataSchema,
  type Ack,
  type Command,
  type CreateWebsiteTestInput,
  type DialogueCueEntry,
  type PlaybackProgress,
  type SessionState,
  type Trigger,
  type WebsiteTestActivity,
  type WebsiteTestMatchedEvent,
  type WebsiteTestRun,
  type WebsiteTestTimerInput,
  type WireNavigate,
} from '@roomkit/shared';
import { PlayerRegistry } from '../players/player-registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  CommandResolver,
  ResolutionError,
  type Resolution,
} from '../runtime/command-resolver';
import { performWebsiteRequest } from '../runtime/website-request';
import {
  NOOP_WEBSITE_TEST_TRANSPORT,
  type WebsiteTestTransport,
} from './website-test-transport';

// Same alphabet as session test codes: no 0/1/l/o, typed on devices.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 6;

/** Play acks land when playback finishes, so the watch must outlive a video. */
const ACK_TIMEOUT_MS = 10 * 60_000;
const ACTIVITY_BUFFER_LIMIT = 300;
const SWEEP_INTERVAL_MS = 30 * 60_000;
const MAX_RUN_AGE_MS = 12 * 60 * 60_000;

/** Manual console: only commands that make sense against the one test device. */
const BLOCKED_MANUAL = new Set<Command['type']>([
  'navigate', // would navigate away from the site under test; use the URL field
  'wait',
  'switchPhase',
  'callEvent',
  'endTheme',
  'adjustTimer',
  'eval',
  'notify',
]);

/** Event runs: flow commands that need a real session engine are skipped. */
const SKIPPED_IN_EVENT = new Set<Command['type']>([
  'navigate',
  'switchPhase',
  'callEvent',
  'endTheme',
  'adjustTimer',
  'eval',
]);

/** Omit that distributes over a union (plain Omit collapses it). */
type ActivityInput<T = WebsiteTestActivity> = T extends unknown
  ? Omit<T, 'id' | 'runId' | 'at'>
  : never;

interface PendingAck {
  timeout: NodeJS.Timeout;
  /** Emits the done/failed/timeout activity and resolves any awaiting run. */
  settle: (status: 'done' | 'failed' | 'timeout') => void;
  promise: Promise<'done' | 'failed' | 'timeout'>;
}

interface EventRunState {
  eventRunId: string;
  eventId: string;
  eventName: string;
  abort: AbortController;
}

/** Activity attribution shared by every command execution path. */
interface CommandMeta {
  source: 'manual' | 'event';
  eventRunId?: string;
  entryIndex?: number;
}

/** Line cues of one in-flight playDialogue, keyed by the speaker wire id. */
interface DialogueCueState {
  /** Cue commands keyed by the line index the device holds before. */
  byLine: Map<number, DialogueCueEntry[]>;
  /** Manual-console origin: cue targets collapse onto the test device too. */
  forceDevice: boolean;
  meta: CommandMeta;
  running: Set<number>;
  completed: Set<number>;
}

interface RunState {
  runId: string;
  themeId: string;
  playerId: string;
  deviceId: string;
  deviceName: string;
  displayName: string;
  url: string;
  code: string;
  phaseId: string | null;
  deviceOnline: boolean;
  /** @roomkit/client version of the attached window; undefined until attach. */
  clientVersion?: string | null;
  /** @roomkit/helper version of the site under test; undefined until a hello. */
  helperVersion?: string | null;
  active: boolean;
  createdAt: number;
  /** Stable across redeliveries (client dedupes); regenerated on url/reload. */
  navigateWireId: string;
  /** Fake websiteId carried on navigate wires (no website asset exists). */
  websiteIdAlias: string;
  /** Base remaining at the last timer mutation; null = no timer. */
  timerRemainingMs: number | null;
  /** Epoch ms while running; null while paused (or no timer). */
  timerRunningSince: number | null;
  pendingAcks: Map<string, PendingAck>;
  eventRun: EventRunState | null;
  /** In-flight dialogue line cues, keyed by the play wire's id. */
  dialogueCues: Map<string, DialogueCueState>;
  activity: WebsiteTestActivity[];
}

/**
 * Ephemeral website-test runs: one player device window pointed at an
 * arbitrary URL, driven manually from studio. Everything lives in this map —
 * nothing is ever persisted, and a server restart discards all runs.
 */
@Injectable()
export class WebsiteTestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebsiteTestService.name);
  private readonly runs = new Map<string, RunState>();
  private readonly byCode = new Map<string, RunState>();
  private transport: WebsiteTestTransport = NOOP_WEBSITE_TEST_TRANSPORT;
  private sweepHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: CommandResolver,
    private readonly players: PlayerRegistry,
  ) {}

  registerTransport(transport: WebsiteTestTransport): void {
    this.transport = transport;
  }

  onModuleInit(): void {
    this.sweepHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    for (const run of [...this.runs.values()]) this.teardown(run);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async createRun(input: CreateWebsiteTestInput): Promise<WebsiteTestRun> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: input.themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');
    if (!this.players.isOnline(input.playerId)) {
      throw new BadRequestException('Player is not connected');
    }
    const device = await this.prisma.asset.findFirst({
      where: { id: input.deviceId, themeId: theme.id, kind: 'device' },
    });
    if (!device) throw new NotFoundException('Device not found in theme');
    const deviceData = DeviceDataSchema.safeParse(device.data);

    // A re-test of the same window replaces the stale run (and its window).
    for (const existing of this.runs.values()) {
      if (
        existing.playerId === input.playerId &&
        existing.deviceId === input.deviceId
      ) {
        this.stopRun(existing.runId);
      }
    }

    const run: RunState = {
      runId: randomUUID(),
      themeId: theme.id,
      playerId: input.playerId,
      deviceId: device.id,
      deviceName: device.name,
      displayName: deviceData.success ? deviceData.data.displayName : '',
      url: input.url,
      code: await this.generateCode(),
      phaseId: await this.getInitialPhaseId(theme.id),
      deviceOnline: false,
      active: true,
      createdAt: Date.now(),
      navigateWireId: randomUUID(),
      websiteIdAlias: randomUUID(),
      timerRemainingMs: theme.timeLimitMs,
      timerRunningSince: theme.timeLimitMs === null ? null : Date.now(),
      pendingAcks: new Map(),
      eventRun: null,
      dialogueCues: new Map(),
      activity: [],
    };
    this.runs.set(run.runId, run);
    this.byCode.set(run.code, run);

    this.players.sendWebsiteTestStart(run.playerId, {
      runId: run.runId,
      themeId: run.themeId,
      url: run.url,
      device: {
        deviceId: run.deviceId,
        deviceName: run.deviceName,
        displayName: run.displayName,
        code: run.code,
      },
    });
    this.broadcastRunState(run);
    this.emitActivity(run, {
      kind: 'status',
      level: 'info',
      message: `웹 테스트 시작 — ${run.url}`,
    });
    return this.serialize(run);
  }

  listRuns(themeId?: string): WebsiteTestRun[] {
    return [...this.runs.values()]
      .filter((run) => !themeId || run.themeId === themeId)
      .map((run) => this.serialize(run));
  }

  getRun(runId: string): WebsiteTestRun {
    return this.serialize(this.getExisting(runId));
  }

  getActivity(runId: string): WebsiteTestActivity[] {
    return [...this.getExisting(runId).activity];
  }

  stopRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.active = false;
    this.emitActivity(run, {
      kind: 'status',
      level: 'info',
      message: '웹 테스트 종료',
    });
    this.broadcastRunState(run);
    this.players.sendWebsiteTestStop(run.playerId, { runId: run.runId });
    this.teardown(run);
    this.transport.disconnectRun(run.runId);
  }

  private teardown(run: RunState): void {
    run.eventRun?.abort.abort();
    run.eventRun = null;
    for (const pending of run.pendingAcks.values()) {
      clearTimeout(pending.timeout);
    }
    run.pendingAcks.clear();
    this.runs.delete(run.runId);
    this.byCode.delete(run.code);
  }

  private sweep(): void {
    const cutoff = Date.now() - MAX_RUN_AGE_MS;
    for (const run of [...this.runs.values()]) {
      if (run.createdAt < cutoff) {
        this.logger.log(`Sweeping stale website test ${run.runId}`);
        this.stopRun(run.runId);
      }
    }
  }

  // ── device socket integration (called by DeviceGateway) ──────────────────

  matchCode(
    code: string,
  ): Pick<
    RunState,
    'runId' | 'deviceId' | 'deviceName' | 'displayName'
  > | null {
    const run = this.byCode.get(code);
    if (!run || !run.active) return null;
    return {
      runId: run.runId,
      deviceId: run.deviceId,
      deviceName: run.deviceName,
      displayName: run.displayName,
    };
  }

  getSessionState(runId: string): SessionState | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const timer = this.timerSnapshot(run);
    return {
      sessionId: run.runId,
      themeId: run.themeId,
      mode: 'test',
      phaseId: run.phaseId,
      state: run.active ? 'running' : 'ended',
      verdict: null,
      timerState: timer.timerState,
      timerRemainingMs: timer.timerRemainingMs,
    };
  }

  getThemeId(runId: string): string | null {
    return this.runs.get(runId)?.themeId ?? null;
  }

  deviceStatusChanged(runId: string, online: boolean): void {
    const run = this.runs.get(runId);
    if (!run || run.deviceOnline === online) return;
    run.deviceOnline = online;
    this.broadcastRunState(run);
    this.emitActivity(run, {
      kind: 'status',
      level: online ? 'info' : 'warn',
      message: online ? '장치 연결됨' : '장치 연결 끊김',
    });
  }

  /**
   * Component versions detected on the run's device window (client version
   * from auth, helper version relayed by the player). Null = the component
   * was seen but predates version reporting.
   */
  deviceVersionsChanged(
    runId: string,
    versions: { clientVersion?: string | null; helperVersion?: string | null },
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;
    let changed = false;
    if (
      versions.clientVersion !== undefined &&
      run.clientVersion !== versions.clientVersion
    ) {
      run.clientVersion = versions.clientVersion;
      changed = true;
    }
    if (
      versions.helperVersion !== undefined &&
      run.helperVersion !== versions.helperVersion
    ) {
      run.helperVersion = versions.helperVersion;
      changed = true;
    }
    if (changed) this.broadcastRunState(run);
  }

  /** Redeliver the navigate on every (re)connect — the client dedupes on id. */
  onDeviceConnected(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.sendNavigate(run, { force: false, announce: false });
  }

  handleAck(runId: string, ack: Ack): void {
    const run = this.runs.get(runId);
    if (!run) return;
    // Dialogue over (finished, skipped, or stopped): drop its un-run line cues.
    run.dialogueCues.delete(ack.commandId);
    const pending = run.pendingAcks.get(ack.commandId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    run.pendingAcks.delete(ack.commandId);
    pending.settle(ack.status);
  }

  /**
   * Dialogue progress from the test device. Only `waiting` matters here
   * (single-window role 'both' needs no subtitle relay): run the line cue,
   * then send the go-ahead. Always answers, or the device would hold forever.
   */
  handleProgress(runId: string, progress: PlaybackProgress): void {
    const run = this.runs.get(runId);
    if (!run || !progress.waiting) return;
    const { commandId, lineIndex } = progress;
    const state = run.dialogueCues.get(commandId);
    const entries = state?.byLine.get(lineIndex);
    if (!state || !entries || state.completed.has(lineIndex)) {
      this.sendCueContinue(run, commandId, lineIndex);
      return;
    }
    if (state.running.has(lineIndex)) return; // go-ahead comes when it ends
    state.running.add(lineIndex);
    void this.runDialogueCue(run, state, commandId, lineIndex, entries);
  }

  private async runDialogueCue(
    run: RunState,
    state: DialogueCueState,
    commandId: string,
    lineIndex: number,
    entries: DialogueCueEntry[],
  ): Promise<void> {
    this.emitActivity(run, {
      kind: 'status',
      level: 'info',
      message: `대사 라인 큐 실행 — ${lineIndex + 1}번째 라인 전 (커맨드 ${entries.length}개)`,
    });
    try {
      for (const entry of entries) {
        if (!run.active) break;
        await this.runSequenceEntry(run, entry, state.meta, {
          forceDevice: state.forceDevice,
        });
      }
    } catch (err) {
      this.logger.error(`Dialogue line cue failed: ${String(err)}`);
    } finally {
      state.running.delete(lineIndex);
      state.completed.add(lineIndex);
      if (run.active) this.sendCueContinue(run, commandId, lineIndex);
    }
  }

  private sendCueContinue(
    run: RunState,
    commandId: string,
    lineIndex: number,
  ): void {
    this.transport.sendProgress(run.runId, run.deviceId, {
      commandId,
      lineIndex,
      waiting: false,
    });
  }

  /** Website triggers are reported, never executed. */
  async handleTrigger(runId: string, trigger: Trigger): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    const matches = await this.matchEvents(run, trigger.event);
    this.emitActivity(run, {
      kind: 'trigger',
      level: 'info',
      message: `트리거 발생: ${trigger.event}`,
      event: trigger.event,
      ...(trigger.payload === undefined ? {} : { payload: trigger.payload }),
      matches,
    });
  }

  handleHintSubmit(runId: string, code: string): { reason: string } {
    const run = this.runs.get(runId);
    if (run) {
      this.emitActivity(run, {
        kind: 'hint',
        level: 'info',
        message: `힌트 코드 입력: ${code}`,
        code,
      });
    }
    // The website gets a well-formed hint:error instead of silence.
    return { reason: 'session_not_running' };
  }

  handleHintNext(runId: string): { reason: string } {
    const run = this.runs.get(runId);
    if (run) {
      this.emitActivity(run, {
        kind: 'status',
        level: 'info',
        message: '힌트 단계 요청 (웹 테스트에서는 무시됨)',
      });
    }
    return { reason: 'session_not_running' };
  }

  // ── studio controls ───────────────────────────────────────────────────────

  async executeManualCommand(runId: string, cmd: Command): Promise<void> {
    const run = this.getExisting(runId);
    if (BLOCKED_MANUAL.has(cmd.type)) {
      this.emitActivity(run, {
        kind: 'command',
        level: 'warn',
        message: `${cmd.type} 커맨드는 웹 테스트에서 실행할 수 없습니다`,
        source: 'manual',
        commandType: cmd.type,
        status: 'blocked',
      });
      throw new BadRequestException(
        `Command type "${cmd.type}" is not available in a website test`,
      );
    }
    let resolution: Resolution;
    try {
      resolution = await this.resolver.resolve(run.themeId, cmd, {
        forceDeviceId: run.deviceId,
      });
    } catch (err) {
      if (err instanceof ResolutionError) {
        this.emitActivity(run, {
          kind: 'command',
          level: 'error',
          message: `${cmd.type} 실행 실패: ${err.message}`,
          source: 'manual',
          commandType: cmd.type,
          status: 'failed',
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    this.dispatch(run, cmd.type, resolution, { source: 'manual' });
  }

  async runEvent(runId: string, eventId: string): Promise<void> {
    const run = this.getExisting(runId);
    if (run.eventRun) {
      throw new ConflictException('An event is already running');
    }
    const row = await this.prisma.asset.findFirst({
      where: { id: eventId, themeId: run.themeId, kind: 'event' },
    });
    if (!row) throw new NotFoundException('Event not found in theme');
    const parsed = assetDataSchemas.event.safeParse(row.data);
    if (!parsed.success) {
      throw new BadRequestException('Event data is invalid');
    }
    const eventRun: EventRunState = {
      eventRunId: randomUUID(),
      eventId: row.id,
      eventName: row.name,
      abort: new AbortController(),
    };
    run.eventRun = eventRun;
    this.emitEventRunStatus(run, eventRun, 'started');
    void this.executeEventRun(run, eventRun, parsed.data.sequence)
      .catch((err: unknown) => {
        this.logger.error(`Event run failed: ${String(err)}`);
      })
      .finally(() => {
        if (run.eventRun?.eventRunId === eventRun.eventRunId) {
          run.eventRun = null;
        }
      });
  }

  cancelEventRun(runId: string): void {
    const run = this.getExisting(runId);
    run.eventRun?.abort.abort();
  }

  reload(runId: string): void {
    const run = this.getExisting(runId);
    run.navigateWireId = randomUUID();
    this.sendNavigate(run, { force: true, announce: true });
  }

  setUrl(runId: string, url: string): WebsiteTestRun {
    const run = this.getExisting(runId);
    if (run.url !== url) {
      run.url = url;
      run.navigateWireId = randomUUID();
      this.emitActivity(run, {
        kind: 'status',
        level: 'info',
        message: `URL 변경 — ${url}`,
      });
      this.sendNavigate(run, { force: false, announce: false });
      this.broadcastRunState(run);
    }
    return this.serialize(run);
  }

  async setPhase(
    runId: string,
    phaseId: string | null,
  ): Promise<WebsiteTestRun> {
    const run = this.getExisting(runId);
    if (phaseId !== null) {
      const phase = await this.prisma.asset.findFirst({
        where: { id: phaseId, themeId: run.themeId, kind: 'phase' },
        select: { id: true },
      });
      if (!phase) throw new NotFoundException('Phase not found in theme');
    }
    run.phaseId = phaseId;
    this.broadcastRunState(run);
    this.broadcastDeviceSessionState(run);
    return this.serialize(run);
  }

  setTimer(runId: string, input: WebsiteTestTimerInput): WebsiteTestRun {
    const run = this.getExisting(runId);
    if ('remainingMs' in input) {
      // Setting a value (re)starts the timer even for themes without one.
      const wasPaused =
        run.timerRemainingMs !== null && run.timerRunningSince === null;
      run.timerRemainingMs = input.remainingMs;
      run.timerRunningSince = wasPaused ? null : Date.now();
    } else if (input.action === 'pause') {
      const snapshot = this.timerSnapshot(run);
      run.timerRemainingMs = snapshot.timerRemainingMs;
      run.timerRunningSince = null;
    } else {
      const snapshot = this.timerSnapshot(run);
      if (snapshot.timerRemainingMs !== null && snapshot.timerRemainingMs > 0) {
        run.timerRemainingMs = snapshot.timerRemainingMs;
        run.timerRunningSince = Date.now();
      }
    }
    this.broadcastRunState(run);
    this.broadcastDeviceSessionState(run);
    return this.serialize(run);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async executeEventRun(
    run: RunState,
    eventRun: EventRunState,
    sequence: (Command & { id: string })[],
  ): Promise<void> {
    const signal = eventRun.abort.signal;
    for (let index = 0; index < sequence.length; index++) {
      if (signal.aborted || !run.active) break;
      const entry = sequence[index];
      const meta = {
        source: 'event' as const,
        eventRunId: eventRun.eventRunId,
        entryIndex: index,
      };
      await this.runSequenceEntry(run, entry, meta, {
        forceDevice: false,
        signal,
      });
    }
    this.emitEventRunStatus(
      run,
      eventRun,
      signal.aborted || !run.active ? 'aborted' : 'finished',
    );
  }

  /**
   * Executes one sequence entry — event runs and dialogue line cues share
   * this. `forceDevice` mirrors the entry's origin: manual-console commands
   * resolve with every target collapsed onto the test device, event entries
   * resolve real targets and keep only the test device's deliveries.
   */
  private async runSequenceEntry(
    run: RunState,
    entry: Command,
    meta: CommandMeta,
    opts: { forceDevice: boolean; signal?: AbortSignal },
  ): Promise<void> {
    if (SKIPPED_IN_EVENT.has(entry.type)) {
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message: `${entry.type} 커맨드 건너뜀 (웹 테스트에서 실행 불가)`,
        commandType: entry.type,
        status: 'skipped',
        ...meta,
      });
      return;
    }
    if (entry.type === 'wait') {
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message: `대기 ${entry.durationMs}ms`,
        commandType: entry.type,
        status: 'done',
        ...meta,
      });
      await abortableSleep(entry.durationMs, opts.signal);
      return;
    }
    if (entry.type === 'notify') {
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message: `알림: ${entry.message}`,
        commandType: entry.type,
        status: 'done',
        ...meta,
      });
      return;
    }
    let resolution: Resolution;
    try {
      resolution = await this.resolver.resolve(
        run.themeId,
        entry,
        opts.forceDevice ? { forceDeviceId: run.deviceId } : {},
      );
    } catch (err) {
      if (err instanceof ResolutionError) {
        this.emitActivity(run, {
          kind: 'command',
          level: 'warn',
          message: `${entry.type} 실행 실패: ${err.message}`,
          commandType: entry.type,
          status: 'failed',
          ...meta,
        });
        return;
      }
      throw err;
    }
    const dropped = resolution.deliveries.filter(
      (d) => d.deviceId !== run.deviceId,
    );
    const kept = resolution.deliveries.filter(
      (d) => d.deviceId === run.deviceId,
    );
    if (dropped.length > 0) {
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message:
          kept.length === 0
            ? `${entry.type} 커맨드 건너뜀 (다른 장치/플레이어 대상)`
            : `${entry.type}: 다른 장치 대상 전송 ${dropped.length}건 건너뜀`,
        commandType: entry.type,
        status: 'skipped',
        ...meta,
      });
    }
    if (kept.length === 0 && !resolution.websiteRequest) return;
    const awaited = this.dispatch(
      run,
      entry.type,
      { ...resolution, deliveries: kept },
      meta,
      opts.signal,
    );
    if (awaited && opts.signal) {
      await Promise.race([awaited, abortedPromise(opts.signal)]);
    } else if (awaited) {
      await awaited;
    }
  }

  /**
   * Sends every delivery, watching acks for activity reporting. Returns a
   * promise for the resolution's awaitAckOf when it survived filtering.
   */
  private dispatch(
    run: RunState,
    commandType: string,
    resolution: Resolution,
    meta: CommandMeta,
    signal?: AbortSignal,
  ): Promise<unknown> | null {
    if (resolution.dialogueCues) {
      const { commandId, byLine, dropped } = resolution.dialogueCues;
      if (dropped > 0) {
        this.emitActivity(run, {
          kind: 'status',
          level: 'warn',
          message: `대사 라인 큐 ${dropped}건 건너뜀 (라인이 없거나 마지막 라인)`,
        });
      }
      if (byLine.size > 0) {
        run.dialogueCues.set(commandId, {
          byLine,
          forceDevice: meta.source === 'manual',
          meta: { source: meta.source, eventRunId: meta.eventRunId },
          running: new Set(),
          completed: new Set(),
        });
      }
    }
    let awaited: Promise<unknown> | null = null;
    if (resolution.websiteRequest) {
      const request = resolution.websiteRequest;
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message: `${commandType} 전송됨 — ${request.method} ${request.url}`,
        commandType,
        status: 'sent',
        ...meta,
      });
      const promise = performWebsiteRequest(request, signal).then((result) => {
        if (signal?.aborted) return result;
        const done = result.status === 'done';
        const detail =
          'error' in result
            ? result.error
            : `HTTP ${result.statusCode}${result.statusText ? ` ${result.statusText}` : ''}`;
        this.emitActivity(run, {
          kind: 'command',
          level: done ? 'info' : 'error',
          message: `${commandType} ${done ? '완료' : '실패'} — ${detail}`,
          commandType,
          status: done ? 'done' : 'failed',
          ...meta,
        });
        return result;
      });
      if (request.waitUntilEnd) awaited = promise;
      else void promise;
    }
    for (const delivery of resolution.deliveries) {
      const sent = this.transport.sendCommand(
        run.runId,
        run.deviceId,
        delivery.wire,
      );
      if (!sent) {
        this.emitActivity(run, {
          kind: 'command',
          level: 'warn',
          message: `${commandType} 전송 실패 — 장치 오프라인`,
          commandType,
          status: 'offline',
          ...meta,
        });
        continue;
      }
      this.emitActivity(run, {
        kind: 'command',
        level: 'info',
        message: `${commandType} 전송됨`,
        commandType,
        status: 'sent',
        ...meta,
      });
      const ackPromise = this.watchAck(run, delivery.wire.id, (status) => {
        this.emitActivity(run, {
          kind: 'command',
          level: status === 'done' ? 'info' : 'error',
          message:
            status === 'done'
              ? `${commandType} 완료`
              : status === 'failed'
                ? `${commandType} 실패 (장치 보고)`
                : `${commandType} 응답 시간 초과`,
          commandType,
          status,
          ...meta,
        });
      });
      if (
        resolution.awaitAckOf &&
        resolution.awaitAckOf.commandId === delivery.wire.id
      ) {
        awaited = ackPromise;
      }
    }
    return awaited;
  }

  private watchAck(
    run: RunState,
    commandId: string,
    onSettle: (status: 'done' | 'failed' | 'timeout') => void,
  ): Promise<'done' | 'failed' | 'timeout'> {
    const previous = run.pendingAcks.get(commandId);
    if (previous) {
      clearTimeout(previous.timeout);
      run.pendingAcks.delete(commandId);
    }
    let settle!: (status: 'done' | 'failed' | 'timeout') => void;
    const promise = new Promise<'done' | 'failed' | 'timeout'>((resolve) => {
      settle = (status) => {
        onSettle(status);
        resolve(status);
      };
    });
    const timeout = setTimeout(() => {
      if (run.pendingAcks.get(commandId)?.timeout === timeout) {
        run.pendingAcks.delete(commandId);
        settle('timeout');
      }
    }, ACK_TIMEOUT_MS);
    timeout.unref();
    run.pendingAcks.set(commandId, { timeout, settle, promise });
    return promise;
  }

  private sendNavigate(
    run: RunState,
    opts: { force: boolean; announce: boolean },
  ): void {
    const wire: WireNavigate = {
      id: run.navigateWireId,
      type: 'navigate',
      websiteId: run.websiteIdAlias,
      url: run.url,
      force: opts.force,
    };
    const sent = this.transport.sendCommand(run.runId, run.deviceId, wire);
    if (opts.announce) {
      this.emitActivity(run, {
        kind: 'status',
        level: sent ? 'info' : 'warn',
        message: sent
          ? '사이트 새로고침 요청됨'
          : '사이트 새로고침 실패 — 장치 오프라인',
      });
    }
    if (!sent) return;
    void this.watchAck(run, wire.id, (status) => {
      this.emitActivity(run, {
        kind: 'status',
        level: status === 'done' ? 'info' : 'error',
        message:
          status === 'done'
            ? '사이트 로드 완료'
            : status === 'failed'
              ? '사이트 로드 실패'
              : '사이트 로드 응답 없음 (URL 접속 가능 여부를 확인하세요)',
      });
    });
  }

  private async matchEvents(
    run: RunState,
    triggerName: string,
  ): Promise<WebsiteTestMatchedEvent[]> {
    const rows = await this.prisma.asset.findMany({
      where: { themeId: run.themeId, kind: 'event' },
      select: { id: true, name: true, data: true },
    });
    const matches: WebsiteTestMatchedEvent[] = [];
    for (const row of rows) {
      const parsed = assetDataSchemas.event.safeParse(row.data);
      if (!parsed.success) continue;
      const data = parsed.data;
      if (data.triggerKind !== 'device' || data.triggerName !== triggerName) {
        continue;
      }
      matches.push({
        eventId: row.id,
        eventName: row.name,
        phaseId: data.phaseId,
        inSimulatedPhase: data.phaseId === null || data.phaseId === run.phaseId,
      });
    }
    return matches;
  }

  private emitEventRunStatus(
    run: RunState,
    eventRun: EventRunState,
    status: 'started' | 'finished' | 'aborted',
  ): void {
    const label =
      status === 'started' ? '시작' : status === 'finished' ? '완료' : '중단';
    this.emitActivity(run, {
      kind: 'eventRun',
      level: 'info',
      message: `이벤트 "${eventRun.eventName}" ${label}`,
      eventRunId: eventRun.eventRunId,
      eventId: eventRun.eventId,
      eventName: eventRun.eventName,
      status,
    });
  }

  private emitActivity(run: RunState, entry: ActivityInput): void {
    const full = {
      ...entry,
      id: randomUUID(),
      runId: run.runId,
      at: Date.now(),
    } as WebsiteTestActivity;
    run.activity.push(full);
    if (run.activity.length > ACTIVITY_BUFFER_LIMIT) {
      run.activity.splice(0, run.activity.length - ACTIVITY_BUFFER_LIMIT);
    }
    this.transport.broadcastActivity(full);
  }

  private broadcastRunState(run: RunState): void {
    this.transport.broadcastRunState(this.serialize(run));
  }

  private broadcastDeviceSessionState(run: RunState): void {
    const state = this.getSessionState(run.runId);
    if (state) this.transport.broadcastRunSessionState(state);
  }

  private timerSnapshot(run: RunState): {
    timerState: 'running' | 'paused' | 'expired' | null;
    timerRemainingMs: number | null;
  } {
    if (run.timerRemainingMs === null) {
      return { timerState: null, timerRemainingMs: null };
    }
    if (run.timerRunningSince !== null) {
      const remaining = Math.max(
        0,
        run.timerRemainingMs - (Date.now() - run.timerRunningSince),
      );
      return {
        timerState: remaining === 0 ? 'expired' : 'running',
        timerRemainingMs: remaining,
      };
    }
    return {
      timerState: run.timerRemainingMs === 0 ? 'expired' : 'paused',
      timerRemainingMs: run.timerRemainingMs,
    };
  }

  private serialize(run: RunState): WebsiteTestRun {
    const timer = this.timerSnapshot(run);
    return {
      runId: run.runId,
      themeId: run.themeId,
      playerId: run.playerId,
      deviceId: run.deviceId,
      deviceName: run.deviceName,
      displayName: run.displayName,
      url: run.url,
      code: run.code,
      phaseId: run.phaseId,
      deviceOnline: run.deviceOnline,
      clientVersion: run.clientVersion,
      helperVersion: run.helperVersion,
      active: run.active,
      timerState: timer.timerState,
      timerRemainingMs: timer.timerRemainingMs,
      createdAt: run.createdAt,
    };
  }

  private getExisting(runId: string): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException('Website test not found');
    return run;
  }

  /**
   * Website-test codes are matched before session test codes AND production
   * device codes in /device auth, so they must collide with neither.
   */
  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (this.byCode.has(code)) continue;
      const sessionCode = await this.prisma.sessionDeviceCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (sessionCode) continue;
      const deviceCode = await this.prisma.asset.findFirst({
        where: { kind: 'device', code },
        select: { id: true },
      });
      if (deviceCode) continue;
      return code;
    }
    throw new ConflictException('Could not generate a unique device code');
  }

  /** Same lowest-order rule as SessionsService.getInitialPhaseId. */
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

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}

function abortedPromise(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
