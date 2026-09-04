import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type {
  PlaybackProgress,
  SessionMedia,
  SessionNotification,
  SessionRuns,
  WireCommand,
} from '@roomkit/shared';
import { SessionRuntimeService } from '../src/runtime/session-runtime.service';
import type { RuntimeTransport } from '../src/runtime/runtime-transport';
import { createTestApp, login } from './helpers';

interface Sent {
  sessionId: string;
  deviceId: string;
  wire: WireCommand;
}

/** Records outbound traffic; per-device online state is controllable. */
class FakeTransport implements RuntimeTransport {
  sent: Sent[] = [];
  progress: { deviceId: string; progress: PlaybackProgress }[] = [];
  runs: SessionRuns[] = [];
  media: SessionMedia[] = [];
  notifications: SessionNotification[] = [];
  offline = new Set<string>();

  sendCommand(sessionId: string, deviceId: string, wire: WireCommand): boolean {
    if (this.offline.has(deviceId)) return false;
    this.sent.push({ sessionId, deviceId, wire });
    return true;
  }
  sendProgress(
    _sessionId: string,
    deviceId: string,
    progress: PlaybackProgress,
  ): void {
    this.progress.push({ deviceId, progress });
  }
  sendHint(): boolean {
    return false;
  }
  broadcastSessionState(): void {}
  broadcastLog(): void {}
  broadcastDeviceStatus(): void {}
  broadcastSessionRuns(runs: SessionRuns): void {
    this.runs.push(runs);
  }
  broadcastSessionMedia(media: SessionMedia): void {
    this.media.push(media);
  }
  broadcastNotification(notification: SessionNotification): void {
    this.notifications.push(notification);
  }

  ofType(type: WireCommand['type']): Sent[] {
    return this.sent.filter((s) => s.wire.type === type);
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timed out');
}

describe('Runtime (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let runtime: SessionRuntimeService;
  let transport: FakeTransport;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    runtime = app.get(SessionRuntimeService);
  });

  beforeEach(() => {
    transport = new FakeTransport();
    runtime.registerTransport(transport);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await auth(request(app.getHttpServer()).post(`/api/sessions/${id}/end`));
    }
    await app.close();
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  async function post(path: string, body?: object) {
    const res = await auth(
      request(server())
        .post(path)
        .send(body ?? {}),
    );
    if (res.status >= 400) {
      throw new Error(
        `POST ${path} -> ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body;
  }

  async function createTheme(
    timeLimitMs: number | null = null,
  ): Promise<string> {
    const body = await post('/api/themes', {
      name: 'runtime e2e',
      timeLimitMs,
    });
    return body.id as string;
  }

  async function createAsset(themeId: string, input: object): Promise<string> {
    const body = await post(`/api/themes/${themeId}/assets`, input);
    return body.id as string;
  }

  function createDevice(themeId: string, name: string) {
    return createAsset(themeId, {
      kind: 'device',
      name,
      code: `${name}-${randomUUID().slice(0, 8)}`,
      data: { displayName: name },
    });
  }

  function createEvent(
    themeId: string,
    name: string,
    data: Partial<{
      phaseId: string | null;
      triggerKind: 'device' | 'manual' | 'system';
      triggerName: string | null;
      manualTriggerable: boolean;
      allowReentry: boolean;
      once: boolean;
      sequence: object[];
    }>,
  ) {
    return createAsset(themeId, {
      kind: 'event',
      name,
      data: {
        phaseId: null,
        triggerKind: 'manual',
        triggerName: null,
        manualTriggerable: true,
        allowReentry: false,
        sequence: [],
        ...data,
      },
    });
  }

  const entry = (cmd: object) => ({ id: randomUUID(), ...cmd });

  async function createSession(themeId: string): Promise<string> {
    const body = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [],
    });
    sessionIds.push(body.id as string);
    await post(`/api/sessions/${body.id}/start`);
    return body.id as string;
  }

  async function getLogs(sessionId: string) {
    const res = await auth(
      request(server()).get(`/api/sessions/${sessionId}/logs?limit=500`),
    ).expect(200);
    return res.body as { kind: string; level: string; message: string }[];
  }

  it('eval mutates persisted vars, logs, and false stops the sequence', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'msg',
      data: { displayName: 'msg', fields: [] },
    });
    const eventId = await createEvent(themeId, 'guarded', {
      sequence: [
        entry({
          type: 'eval',
          code: 'ctx.vars.count = 41 + 1; ctx.log("from eval");',
        }),
        entry({ type: 'eval', code: 'ctx.vars.count === 42 ? false : true' }),
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) =>
        l.message.includes('sequence stopped'),
      ),
    );
    const session = await auth(
      request(server()).get(`/api/sessions/${sessionId}`),
    ).expect(200);
    expect(session.body.vars).toEqual({ count: 42 });
    const logs = await getLogs(sessionId);
    expect(
      logs.some((l) => l.kind === 'eval' && l.message === 'from eval'),
    ).toBe(true);
    // guard stopped the sequence before the message command
    expect(transport.ofType('message')).toHaveLength(0);
  });

  it('notify broadcasts to admins and logs; empty message is skipped', async () => {
    const themeId = await createTheme();
    const eventId = await createEvent(themeId, 'notifier', {
      sequence: [
        entry({ type: 'notify', message: '  ' }),
        entry({ type: 'notify', message: 'check the door lock' }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.notifications.length > 0);
    expect(transport.notifications).toEqual([
      { sessionId, message: 'check the door lock' },
    ]);
    // Log writes are async — poll until both entries land.
    await waitFor(async () => {
      const logs = await getLogs(sessionId);
      return (
        logs.some((l) =>
          l.message.includes('notify skipped: message not set'),
        ) &&
        logs.some((l) =>
          l.message.includes('Operator notification: check the door lock'),
        )
      );
    });
  });

  it('ctx.trigger fires a device-trigger event', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'msg',
      data: { displayName: 'msg', fields: [] },
    });
    await createEvent(themeId, 'listener', {
      triggerKind: 'device',
      triggerName: 'btn',
      sequence: [
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const chainerId = await createEvent(themeId, 'chainer', {
      sequence: [entry({ type: 'eval', code: 'ctx.trigger("btn")' })],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId: chainerId });

    await waitFor(() => transport.ofType('message').length === 1);
  });

  it('switchPhase awaits leave hooks, then fires enter hooks', async () => {
    const themeId = await createTheme();
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    const p2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P2',
      data: { order: 2 },
    });
    await createEvent(themeId, 'on-leave-p1', {
      phaseId: p1,
      triggerKind: 'system',
      triggerName: 'phase:leave',
      sequence: [
        entry({ type: 'eval', code: 'ctx.log("leaving P1 in " + ctx.phase)' }),
      ],
    });
    await createEvent(themeId, 'on-enter-p2', {
      phaseId: p2,
      triggerKind: 'system',
      triggerName: 'phase:enter',
      sequence: [
        entry({ type: 'eval', code: 'ctx.log("entered P2 in " + ctx.phase)' }),
      ],
    });
    const sessionId = await createSession(themeId);
    expect(
      (await auth(request(server()).get(`/api/sessions/${sessionId}`))).body
        .phaseId,
    ).toBe(p1);

    await post(`/api/sessions/${sessionId}/phase`, { phaseId: p2 });
    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message.includes('entered P2')),
    );

    const logs = await getLogs(sessionId);
    const leaveIdx = logs.findIndex((l) => l.message === 'leaving P1 in P1');
    const switchIdx = logs.findIndex((l) => l.kind === 'phase');
    const enterIdx = logs.findIndex((l) => l.message === 'entered P2 in P2');
    expect(leaveIdx).toBeGreaterThanOrEqual(0);
    expect(enterIdx).toBeGreaterThanOrEqual(0);
    expect(leaveIdx).toBeLessThan(switchIdx);
    expect(switchIdx).toBeLessThan(enterIdx);

    const session = await auth(
      request(server()).get(`/api/sessions/${sessionId}`),
    ).expect(200);
    expect(session.body.phaseId).toBe(p2);
  });

  it('fires phase:enter for the initial phase on session start', async () => {
    const themeId = await createTheme();
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    await createEvent(themeId, 'on-enter-p1', {
      phaseId: p1,
      triggerKind: 'system',
      triggerName: 'phase:enter',
      sequence: [
        entry({ type: 'eval', code: 'ctx.log("entered " + ctx.phase)' }),
      ],
    });
    const sessionId = await createSession(themeId);

    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message === 'entered P1'),
    );
  });

  it('restarting the current phase re-fires its leave and enter hooks', async () => {
    const themeId = await createTheme();
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    await createEvent(themeId, 'on-enter-p1', {
      phaseId: p1,
      triggerKind: 'system',
      triggerName: 'phase:enter',
      sequence: [entry({ type: 'eval', code: 'ctx.log("enter hook")' })],
    });
    await createEvent(themeId, 'on-leave-p1', {
      phaseId: p1,
      triggerKind: 'system',
      triggerName: 'phase:leave',
      sequence: [entry({ type: 'eval', code: 'ctx.log("leave hook")' })],
    });
    const sessionId = await createSession(themeId);
    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message === 'enter hook'),
    );

    await post(`/api/sessions/${sessionId}/phase/restart`);
    await waitFor(async () => {
      const logs = await getLogs(sessionId);
      return (
        logs.some((l) => l.message === 'leave hook') &&
        logs.filter((l) => l.message === 'enter hook').length === 2
      );
    });
    const logs = await getLogs(sessionId);
    const leaveIdx = logs.findIndex((l) => l.message === 'leave hook');
    const restartIdx = logs.findIndex((l) => l.message.includes('restarted'));
    expect(leaveIdx).toBeGreaterThanOrEqual(0);
    expect(leaveIdx).toBeLessThan(restartIdx);
    // The session never left the phase.
    const session = await auth(
      request(server()).get(`/api/sessions/${sessionId}`),
    ).expect(200);
    expect(session.body.phaseId).toBe(p1);
  });

  it('leaving a phase resets once-tracking so re-entry runs once events afresh', async () => {
    const themeId = await createTheme();
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    const p2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P2',
      data: { order: 2 },
    });
    const onceId = await createEvent(themeId, 'once-in-p1', {
      phaseId: p1,
      once: true,
      sequence: [entry({ type: 'eval', code: 'ctx.log("once ran")' })],
    });
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/trigger`, { eventId: onceId });
    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message === 'once ran'),
    );
    // Second trigger while still in P1 is rejected (once).
    const res = await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/trigger`)
        .send({ eventId: onceId }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Leave P1 and come back: the once flag must be reset.
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: p2 });
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: p1 });
    await post(`/api/sessions/${sessionId}/trigger`, { eventId: onceId });
    await waitFor(async () => {
      const logs = await getLogs(sessionId);
      return logs.filter((l) => l.message === 'once ran').length === 2;
    });
  });

  it('switching phase aborts in-flight runs of the old phase mid-wait', async () => {
    const themeId = await createTheme();
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    const p2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P2',
      data: { order: 2 },
    });
    const stuckId = await createEvent(themeId, 'stuck-in-p1', {
      phaseId: p1,
      sequence: [
        entry({ type: 'wait', durationMs: 60_000 }),
        entry({ type: 'notify', message: 'stale tail' }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId: stuckId });
    await waitFor(() =>
      transport.runs.some((r) => r.runs.some((run) => run.eventId === stuckId)),
    );

    await post(`/api/sessions/${sessionId}/phase`, { phaseId: p2 });
    // The 60s wait is interrupted immediately; the run dies without its tail.
    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) =>
        l.message.includes('"stuck-in-p1" aborted'),
      ),
    );
    expect(transport.notifications).toHaveLength(0);
    // The run is gone from the active-runs snapshot.
    const last = transport.runs.at(-1);
    expect(last?.runs.filter((run) => run.eventId === stuckId)).toHaveLength(0);
  });

  it('endTheme resets all devices, records the verdict, and ends the session', async () => {
    const themeId = await createTheme();
    await createDevice(themeId, 'dev-a');
    await createDevice(themeId, 'dev-b');
    const eventId = await createEvent(themeId, 'game-over', {
      sequence: [
        entry({ type: 'endTheme', verdict: 'fail' }),
        // Must never run: the sequence stops at endTheme.
        entry({ type: 'eval', code: 'ctx.log("after endTheme")' }),
      ],
    });
    const sessionId = await createSession(themeId);
    expect(
      (await auth(request(server()).get(`/api/sessions/${sessionId}`))).body
        .verdict,
    ).toBeNull();

    await post(`/api/sessions/${sessionId}/trigger`, { eventId });
    await waitFor(() => transport.ofType('reset').length === 2);
    await waitFor(async () => {
      const { body } = await auth(
        request(server()).get(`/api/sessions/${sessionId}`),
      );
      return body.verdict === 'fail' && body.state === 'ended';
    });
    const logs = await getLogs(sessionId);
    expect(logs.some((l) => l.message.includes('verdict "fail"'))).toBe(true);
    expect(logs.some((l) => l.message === 'Session ended')).toBe(true);
    expect(logs.some((l) => l.message.includes('after endTheme'))).toBe(false);
  });

  it('broadcasts running events while a sequence executes', async () => {
    const themeId = await createTheme();
    const eventId = await createEvent(themeId, 'slow-event', {
      sequence: [
        entry({ type: 'wait', durationMs: 100 }),
        entry({ type: 'eval', code: 'true' }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    // Mid-run snapshot: the event shows up with its current entry.
    await waitFor(() =>
      transport.runs.some(
        (r) =>
          r.sessionId === sessionId &&
          r.runs.some(
            (run) =>
              run.eventName === 'slow-event' &&
              run.commandType === 'wait' &&
              run.entryCount === 2,
          ),
      ),
    );
    // Final snapshot: the run disappears when the sequence finishes.
    await waitFor(() => {
      const last = transport.runs
        .filter((r) => r.sessionId === sessionId)
        .at(-1);
      return last !== undefined && last.runs.length === 0;
    });
  });

  it('enforces the phase guard for device triggers', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'msg',
      data: { displayName: 'msg', fields: [] },
    });
    const p1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    const p2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P2',
      data: { order: 2 },
    });
    void p1;
    await createEvent(themeId, 'p2-only', {
      phaseId: p2,
      triggerKind: 'device',
      triggerName: 'btn',
      sequence: [
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const sessionId = await createSession(themeId); // starts in P1
    runtime.handleDeviceTrigger(sessionId, deviceId, { event: 'btn' });

    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) =>
        l.message.includes('out of phase'),
      ),
    );
    expect(transport.ofType('message')).toHaveLength(0);
  });

  it('callEvent reuses sequences and the depth limit stops cycles', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'msg',
      data: { displayName: 'msg', fields: [] },
    });
    const calleeId = await createEvent(themeId, 'callee', {
      sequence: [
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const callerId = await createEvent(themeId, 'caller', {
      sequence: [entry({ type: 'callEvent', eventId: calleeId })],
    });
    // self-recursion; allowReentry so only the depth limit stops it
    const bombId = await createEvent(themeId, 'bomb', {
      allowReentry: true,
      sequence: [],
    });
    await auth(
      request(server())
        .patch(`/api/themes/${themeId}/assets/${bombId}`)
        .send({
          data: {
            phaseId: null,
            triggerKind: 'manual',
            triggerName: null,
            manualTriggerable: true,
            allowReentry: true,
            sequence: [entry({ type: 'callEvent', eventId: bombId })],
          },
        }),
    ).expect(200);

    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId: callerId });
    await waitFor(() => transport.ofType('message').length === 1);

    await post(`/api/sessions/${sessionId}/trigger`, { eventId: bombId });
    await waitFor(async () =>
      (await getLogs(sessionId)).some(
        (l) => l.level === 'error' && l.message.includes('depth limit'),
      ),
    );
  });

  it('callEvent default is fire-and-forget; waitUntilFinish blocks', async () => {
    const themeId = await createTheme();
    const calleeId = await createEvent(themeId, 'slow-callee', {
      allowReentry: true,
      sequence: [
        entry({ type: 'wait', durationMs: 200 }),
        entry({ type: 'notify', message: 'callee done' }),
      ],
    });
    const forkId = await createEvent(themeId, 'fork', {
      sequence: [
        entry({ type: 'callEvent', eventId: calleeId }), // default: no wait
        entry({ type: 'notify', message: 'after fork' }),
      ],
    });
    const joinId = await createEvent(themeId, 'join', {
      sequence: [
        entry({ type: 'callEvent', eventId: calleeId, waitUntilFinish: true }),
        entry({ type: 'notify', message: 'after join' }),
      ],
    });
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/trigger`, { eventId: forkId });
    await waitFor(() => transport.notifications.length === 2);
    expect(transport.notifications.map((n) => n.message)).toEqual([
      'after fork',
      'callee done',
    ]);

    transport.notifications = [];
    await post(`/api/sessions/${sessionId}/trigger`, { eventId: joinId });
    await waitFor(() => transport.notifications.length === 2);
    expect(transport.notifications.map((n) => n.message)).toEqual([
      'callee done',
      'after join',
    ]);
  });

  it('stop commands with allPlayers fan out per channel with playerId null', async () => {
    const themeId = await createTheme();
    const speakerA = await createDevice(themeId, 'speakerA');
    const screenA = await createDevice(themeId, 'screenA');
    const bothB = await createDevice(themeId, 'bothB');
    await createAsset(themeId, {
      kind: 'player',
      name: 'A',
      data: {
        speakerDeviceId: speakerA,
        screenDeviceId: screenA,
        subtitleCss: '',
      },
    });
    await createAsset(themeId, {
      kind: 'player',
      name: 'B',
      data: { speakerDeviceId: bothB, screenDeviceId: bothB, subtitleCss: '' },
    });
    const eventId = await createEvent(themeId, 'stop-everything', {
      sequence: [
        entry({ type: 'stopBgm', playerId: null, allPlayers: true }),
        entry({ type: 'stopVideo', playerId: null, allPlayers: true }),
        entry({ type: 'stopDialogue', playerId: null, allPlayers: true }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    // bgm: 2 speakers, video: 2 screens, dialogue: 3 distinct devices
    await waitFor(() => transport.ofType('stop').length === 7);
    const stops = transport.ofType('stop').map((s) => ({
      channel: (s.wire as { channel: string }).channel,
      deviceId: s.deviceId,
      playerId: (s.wire as { playerId: string | null }).playerId,
    }));
    expect(stops.every((s) => s.playerId === null)).toBe(true);
    const byChannel = (channel: string) =>
      stops
        .filter((s) => s.channel === channel)
        .map((s) => s.deviceId)
        .sort();
    expect(byChannel('bgm')).toEqual([speakerA, bothB].sort());
    expect(byChannel('video')).toEqual([screenA, bothB].sort());
    expect(byChannel('dialogue')).toEqual([speakerA, screenA, bothB].sort());
  });

  it('resolves BGM play, volume adjustment, and stop to the speaker', async () => {
    const themeId = await createTheme();
    const speakerId = await createDevice(themeId, 'speaker');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: {
        speakerDeviceId: speakerId,
        screenDeviceId: speakerId,
        subtitleCss: '',
      },
    });
    const bgmId = await createAsset(themeId, {
      kind: 'bgm',
      name: 'track',
      data: {
        fileKey: 'themes/test/track.mp3',
        fadeInMs: 1000,
        fadeOutMs: 2500,
      },
    });
    const eventId = await createEvent(themeId, 'bgm-cycle', {
      sequence: [
        entry({ type: 'playBgm', bgmId, playerId, loop: true }),
        entry({ type: 'adjustBgmVolume', playerId, value: 35, durationMs: 800 }),
        entry({ type: 'stopBgm', playerId, allPlayers: false }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(
      () =>
        transport.ofType('bgmVolume').length === 1 &&
        transport.ofType('stop').length === 1,
    );
    const play = transport.ofType('play')[0];
    expect(play.wire).toMatchObject({
      channel: 'bgm',
      fadeInMs: 1000,
      fadeOutMs: 2500,
    });
    const volume = transport.ofType('bgmVolume')[0];
    expect(volume).toMatchObject({
      deviceId: speakerId,
      wire: { playerId, value: 0.35, durationMs: 800 },
    });
    const stop = transport.ofType('stop')[0];
    expect(stop.wire).toMatchObject({ channel: 'bgm', playerId });
    expect('fadeOutMs' in stop.wire).toBe(false);
  });

  it('eval ctx engine actions: notify, switchPhase by name, adjustTimer', async () => {
    const themeId = await createTheme(600_000);
    await createAsset(themeId, {
      kind: 'phase',
      name: 'P1',
      data: { order: 1 },
    });
    const p2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'P2',
      data: { order: 2 },
    });
    const eventId = await createEvent(themeId, 'actions', {
      sequence: [
        entry({
          type: 'eval',
          code: `ctx.notify("from eval"); ctx.switchPhase("P2"); ctx.switchPhase("nope"); ctx.adjustTimer(60000); ctx.adjustTimer('pause');`,
        }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.notifications.length === 1);
    expect(transport.notifications[0].message).toBe('from eval');
    await waitFor(async () => {
      const s = await auth(request(server()).get(`/api/sessions/${sessionId}`));
      return s.body.phaseId === p2;
    });
    await waitFor(async () => {
      const logs = await getLogs(sessionId);
      return (
        logs.some((l) =>
          l.message.includes('ctx.switchPhase skipped: phase "nope" not found'),
        ) &&
        logs.some((l) => l.message.includes('Timer adjusted by 60000ms')) &&
        logs.some((l) => l.message.includes('Timer paused'))
      );
    });
  });

  it('eval ctx.endTheme ends the session and skips later queued actions', async () => {
    const themeId = await createTheme();
    const eventId = await createEvent(themeId, 'ender', {
      sequence: [
        entry({
          type: 'eval',
          // "before end" is queued before endTheme so it runs (even though the
          // script also returns false); "never" is queued after and is skipped.
          code: `ctx.notify("before end"); ctx.endTheme("fail"); ctx.notify("never"); false;`,
        }),
        entry({ type: 'notify', message: 'after entry' }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(async () => {
      const s = await auth(request(server()).get(`/api/sessions/${sessionId}`));
      return s.body.state === 'ended';
    });
    const s = await auth(
      request(server()).get(`/api/sessions/${sessionId}`),
    ).expect(200);
    expect(s.body.verdict).toBe('fail');
    expect(transport.notifications.map((n) => n.message)).toEqual([
      'before end',
    ]);
  });

  it('showHintCode delivers the code with device CSS; hideHintCode all fans out', async () => {
    const themeId = await createTheme();
    const screenId = await createAsset(themeId, {
      kind: 'device',
      name: 'screen',
      code: `screen-${randomUUID().slice(0, 8)}`,
      data: {
        displayName: 'screen',
        hintCodeCss: '.rk-hint-code { color: red; }',
      },
    });
    const otherId = await createDevice(themeId, 'other');
    const hintId = await createAsset(themeId, {
      kind: 'hint',
      name: 'clue',
      code: '4242',
      data: {
        steps: [{ textHtml: 'step', imageKey: null }],
        params: { theme: 'dark' },
      },
    });
    const eventId = await createEvent(themeId, 'hint-code', {
      sequence: [
        entry({ type: 'showHintCode', hintId, deviceId: screenId }),
        entry({ type: 'hideHintCode', deviceId: null, allDevices: true }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.ofType('hintCode').length === 3);
    const [show, ...hides] = transport.ofType('hintCode');
    expect(show.deviceId).toBe(screenId);
    expect(show.wire).toMatchObject({
      code: '4242',
      css: '.rk-hint-code { color: red; }',
      params: { theme: 'dark' },
    });
    expect(hides.map((h) => h.deviceId).sort()).toEqual(
      [screenId, otherId].sort(),
    );
    expect(
      hides.every((h) => (h.wire as { code: string | null }).code === null),
    ).toBe(true);
  });

  it('video and dialogue asset params ride their play wires', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'screen');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: {
        speakerDeviceId: deviceId,
        screenDeviceId: deviceId,
        subtitleCss: '',
      },
    });
    const videoId = await createAsset(themeId, {
      kind: 'video',
      name: 'clip',
      data: {
        fileKey: 'themes/test/clip.mp4',
        frame: { x: 10, y: 20, width: 50, height: 40 },
        params: { overlay: 'chat', volume: 0.5 },
      },
    });
    const dialogueId = await createAsset(themeId, {
      kind: 'dialogue',
      name: 'intro',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [
          {
            id: randomUUID(),
            fileKey: null,
            durationMs: 1000,
            subtitleHtml: 'hello',
          },
        ],
        params: { speaker: '함장' },
      },
    });
    const eventId = await createEvent(themeId, 'play-both', {
      sequence: [
        entry({ type: 'playVideo', videoId, playerId, waitUntilEnd: false }),
        entry({
          type: 'playDialogue',
          dialogueId,
          playerId,
          waitUntilEnd: false,
        }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.ofType('play').length === 2);
    const wires = transport.ofType('play').map((p) => p.wire);
    const video = wires.find(
      (w) => (w as { assetId: string }).assetId === videoId,
    );
    const dialogue = wires.find(
      (w) => (w as { assetId: string }).assetId === dialogueId,
    );
    expect(video).toMatchObject({
      frame: { x: 10, y: 20, width: 50, height: 40 },
      params: { overlay: 'chat', volume: 0.5 },
    });
    expect(dialogue).toMatchObject({ params: { speaker: '함장' } });
  });

  it('waitUntilEnd blocks until the ack and offline devices do not block', async () => {
    const themeId = await createTheme();
    const speakerId = await createDevice(themeId, 'speaker');
    const otherId = await createDevice(themeId, 'other');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: {
        speakerDeviceId: speakerId,
        screenDeviceId: speakerId,
        subtitleCss: '',
      },
    });
    const videoId = await createAsset(themeId, {
      kind: 'video',
      name: 'clip',
      data: { fileKey: 'themes/test/clip.mp4' },
    });
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'after',
      data: { displayName: 'after', fields: [] },
    });
    const eventId = await createEvent(themeId, 'video-then-message', {
      sequence: [
        entry({ type: 'playVideo', videoId, playerId, waitUntilEnd: true }),
        entry({
          type: 'sendMessage',
          deviceId: otherId,
          messageId,
          values: {},
        }),
      ],
    });
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/trigger`, { eventId });
    await waitFor(() => transport.ofType('play').length === 1);
    const play = transport.ofType('play')[0];
    expect(play.wire).toMatchObject({ channel: 'video', playerId });
    expect((play.wire as { url: string }).url).toContain('clip.mp4');

    // no ack yet -> the message must not have been sent
    await new Promise((r) => setTimeout(r, 150));
    expect(transport.ofType('message')).toHaveLength(0);

    runtime.handleAck(sessionId, speakerId, {
      commandId: play.wire.id,
      status: 'done',
    });
    await waitFor(() => transport.ofType('message').length === 1);
    // duplicate ack is harmless
    runtime.handleAck(sessionId, speakerId, {
      commandId: play.wire.id,
      status: 'done',
    });

    // offline device: logged, sequence continues immediately
    transport.offline.add(speakerId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });
    await waitFor(() => transport.ofType('message').length === 2);
    const logs = await getLogs(sessionId);
    expect(logs.some((l) => l.message.includes('device offline'))).toBe(true);
  });

  it('navigate waits for the website-changed ack', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'screen');
    const otherId = await createDevice(themeId, 'other');
    const websiteId = await createAsset(themeId, {
      kind: 'website',
      name: 'site',
      data: { mode: 'external', url: 'https://example.com/' },
    });
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'after-nav',
      data: { displayName: 'after-nav', fields: [] },
    });
    const eventId = await createEvent(themeId, 'navigate-then-message', {
      allowReentry: true,
      sequence: [
        entry({ type: 'navigate', deviceId, websiteId }),
        entry({
          type: 'sendMessage',
          deviceId: otherId,
          messageId,
          values: {},
        }),
      ],
    });
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/trigger`, { eventId });
    await waitFor(() => transport.ofType('navigate').length === 1);
    const nav = transport.ofType('navigate')[0];
    expect(nav.wire).toMatchObject({ websiteId, url: 'https://example.com/' });

    // no ack yet -> the website is not confirmed changed, message must wait
    await new Promise((r) => setTimeout(r, 150));
    expect(transport.ofType('message')).toHaveLength(0);

    runtime.handleAck(sessionId, deviceId, {
      commandId: nav.wire.id,
      status: 'done',
    });
    await waitFor(() => transport.ofType('message').length === 1);

    // offline device: logged, sequence continues immediately
    transport.offline.add(deviceId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });
    await waitFor(() => transport.ofType('message').length === 2);
    const logs = await getLogs(sessionId);
    expect(logs.some((l) => l.message.includes('device offline'))).toBe(true);
  });

  it('splits dialogue across speaker and screen with a progress relay', async () => {
    const themeId = await createTheme();
    const speakerId = await createDevice(themeId, 'speaker');
    const screenId = await createDevice(themeId, 'screen');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'split',
      data: {
        speakerDeviceId: speakerId,
        screenDeviceId: screenId,
        subtitleCss: '.s{}',
      },
    });
    const dialogueId = await createAsset(themeId, {
      kind: 'dialogue',
      name: 'talk',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [
          {
            id: randomUUID(),
            fileKey: 'themes/test/l1.mp3',
            subtitleHtml: '<b>1</b>',
          },
          {
            id: randomUUID(),
            fileKey: 'themes/test/l2.mp3',
            subtitleHtml: '<b>2</b>',
          },
        ],
      },
    });
    const eventId = await createEvent(themeId, 'talk', {
      sequence: [
        entry({
          type: 'playDialogue',
          dialogueId,
          playerId,
          waitUntilEnd: false,
        }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.ofType('play').length === 2);
    const bySpeaker = transport
      .ofType('play')
      .find((s) => s.deviceId === speakerId);
    const byScreen = transport
      .ofType('play')
      .find((s) => s.deviceId === screenId);
    expect(bySpeaker?.wire).toMatchObject({
      channel: 'dialogue',
      role: 'speaker',
    });
    expect(byScreen?.wire).toMatchObject({
      channel: 'dialogue',
      role: 'screen',
      subtitleCss: '.s{}',
    });
    expect((byScreen!.wire as { lines: unknown[] }).lines).toHaveLength(2);

    // speaker progress relays to the screen with the screen's command id
    runtime.handleProgress(sessionId, speakerId, {
      commandId: bySpeaker!.wire.id,
      lineIndex: 1,
      waiting: false,
    });
    expect(transport.progress).toEqual([
      {
        deviceId: screenId,
        progress: {
          commandId: byScreen!.wire.id,
          lineIndex: 1,
          waiting: false,
        },
      },
    ]);

    // the speaker's ack ends the dialogue: the screen gets an out-of-range
    // lineIndex sentinel (= lines.length) so it can clear its subtitle
    runtime.handleAck(sessionId, speakerId, {
      commandId: bySpeaker!.wire.id,
      status: 'done',
    });
    expect(transport.progress[1]).toEqual({
      deviceId: screenId,
      progress: { commandId: byScreen!.wire.id, lineIndex: 2, waiting: false },
    });
    // relay is gone — further acks/progress relay nothing
    runtime.handleProgress(sessionId, speakerId, {
      commandId: bySpeaker!.wire.id,
      lineIndex: 1,
      waiting: false,
    });
    expect(transport.progress).toHaveLength(2);
  });

  it('runs line cue commands during a dialogue hold, then releases the speaker', async () => {
    const themeId = await createTheme();
    const stageDeviceId = await createDevice(themeId, 'stage');
    const propDeviceId = await createDevice(themeId, 'prop');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'both',
      data: {
        speakerDeviceId: stageDeviceId,
        screenDeviceId: stageDeviceId,
        subtitleCss: '',
      },
    });
    const lineIds = [randomUUID(), randomUUID(), randomUUID()];
    const dialogueId = await createAsset(themeId, {
      kind: 'dialogue',
      name: 'cued talk',
      data: {
        keepSubtitleAfterEnd: false,
        lines: lineIds.map((id, i) => ({
          id,
          fileKey: `themes/test/cue-l${i}.mp3`,
          subtitleHtml: `<b>${i}</b>`,
        })),
      },
    });
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'cue-msg',
      data: { displayName: 'cue-msg', fields: [] },
    });
    const eventId = await createEvent(themeId, 'cued talk', {
      sequence: [
        entry({
          type: 'playDialogue',
          dialogueId,
          playerId,
          waitUntilEnd: false,
          lineCues: [
            {
              afterLineId: lineIds[0],
              sequence: [
                entry({
                  type: 'sendMessage',
                  deviceId: propDeviceId,
                  messageId,
                  values: {},
                }),
              ],
            },
            // Anchored to the last line — no gap follows; dropped with a warning.
            {
              afterLineId: lineIds[2],
              sequence: [
                entry({
                  type: 'sendMessage',
                  deviceId: propDeviceId,
                  messageId,
                  values: {},
                }),
              ],
            },
          ],
        }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.ofType('play').length === 1);
    const play = transport.ofType('play')[0];
    const lines = (play.wire as { lines: { holdBefore: boolean }[] }).lines;
    // only the line after the (valid) cue anchor holds
    expect(lines.map((l) => l.holdBefore)).toEqual([false, true, false]);
    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) =>
        l.message.includes('line cue(s) skipped'),
      ),
    );

    // the speaker holds before line 1 → the cue's command runs, then a plain
    // progress for the same line releases the hold
    runtime.handleProgress(sessionId, stageDeviceId, {
      commandId: play.wire.id,
      lineIndex: 1,
      waiting: true,
    });
    await waitFor(() => transport.progress.length === 1);
    expect(transport.ofType('message')).toHaveLength(1);
    expect(transport.ofType('message')[0].deviceId).toBe(propDeviceId);
    expect(transport.progress[0]).toEqual({
      deviceId: stageDeviceId,
      progress: { commandId: play.wire.id, lineIndex: 1, waiting: false },
    });

    // a re-announce (reconnect) after completion answers again without
    // re-running the cue
    runtime.handleProgress(sessionId, stageDeviceId, {
      commandId: play.wire.id,
      lineIndex: 1,
      waiting: true,
    });
    await waitFor(() => transport.progress.length === 2);
    expect(transport.ofType('message')).toHaveLength(1);

    // after the final ack the cue state is gone; a stray hold still gets an
    // immediate go-ahead so no speaker can hang
    runtime.handleAck(sessionId, stageDeviceId, {
      commandId: play.wire.id,
      status: 'done',
    });
    runtime.handleProgress(sessionId, stageDeviceId, {
      commandId: play.wire.id,
      lineIndex: 1,
      waiting: true,
    });
    await waitFor(() => transport.progress.length === 3);
    expect(transport.ofType('message')).toHaveLength(1);
  });

  it('fires timer:expired and recovers sessions across restarts', async () => {
    const themeId = await createTheme(400);
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'game-over',
      data: { displayName: 'game-over', fields: [] },
    });
    await createEvent(themeId, 'on-expire', {
      triggerKind: 'system',
      triggerName: 'timer:expired',
      sequence: [
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const sessionId = await createSession(themeId);

    await waitFor(() => transport.ofType('message').length === 1, 3000);
    const session = await auth(
      request(server()).get(`/api/sessions/${sessionId}`),
    ).expect(200);
    expect(session.body.timerRemainingMs).toBe(0);
    expect(session.body.state).toBe('running');

    // ── restart recovery ──
    const theme2 = await createTheme(60_000);
    await createDevice(theme2, 'dev2');
    const session2 = await createSession(theme2);
    // vars survive via write-through persistence
    const evalEventId = await createEvent(theme2, 'setter', {
      sequence: [entry({ type: 'eval', code: 'ctx.vars.answer = 42' })],
    });
    await post(`/api/sessions/${session2}/trigger`, { eventId: evalEventId });
    await waitFor(async () =>
      (await getLogs(session2)).some((l) =>
        l.message.includes('"setter" finished'),
      ),
    );

    await app.close();
    app = await createTestApp();
    token = await login(app);
    runtime = app.get(SessionRuntimeService);
    transport = new FakeTransport();
    runtime.registerTransport(transport);

    const recovered = await auth(
      request(server()).get(`/api/sessions/${session2}`),
    ).expect(200);
    expect(recovered.body.state).toBe('running');
    expect(recovered.body.vars).toEqual({ answer: 42 });
    await waitFor(async () =>
      (await getLogs(session2)).some((l) =>
        l.message.includes('Runtime restarted'),
      ),
    );

    // the recovered engine still runs sequences
    await post(`/api/sessions/${session2}/trigger`, { eventId: evalEventId });
    await waitFor(
      async () =>
        (await getLogs(session2)).filter((l) =>
          l.message.includes('"setter" finished'),
        ).length >= 2,
    );
  });

  it('admin abort terminates a running event mid-wait', async () => {
    const themeId = await createTheme();
    const eventId = await createEvent(themeId, 'sleeper', {
      sequence: [entry({ type: 'wait', durationMs: 60_000 })],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => (transport.runs.at(-1)?.runs.length ?? 0) === 1);

    // the REST runs listing exposes the runId (console / MCP abort flow)
    const listed = await auth(
      request(server()).get(`/api/sessions/${sessionId}/runs`),
    ).expect(200);
    expect(listed.body.runs).toHaveLength(1);
    const runId = listed.body.runs[0].runId as string;
    expect(runId).toBe(transport.runs.at(-1)!.runs[0].runId);

    await post(`/api/sessions/${sessionId}/runs/${runId}/abort`);
    await waitFor(() => transport.runs.at(-1)?.runs.length === 0);
    const logs = await getLogs(sessionId);
    expect(
      logs.some((l) => l.message.includes('"sleeper" terminated by admin')),
    ).toBe(true);
    expect(logs.some((l) => l.message.includes('"sleeper" aborted'))).toBe(
      true,
    );

    // unknown run id → 400
    await auth(
      request(server()).post(
        `/api/sessions/${sessionId}/runs/${randomUUID()}/abort`,
      ),
    ).expect(400);
  });

  it('admin command endpoint plays media; tracking survives the loop ack and clears on stop', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'stage');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: {
        speakerDeviceId: deviceId,
        screenDeviceId: deviceId,
        subtitleCss: '',
      },
    });
    const bgmId = await createAsset(themeId, {
      kind: 'bgm',
      name: 'ambient',
      data: { fileKey: 'themes/test/ambient.mp3' },
    });
    const websiteId = await createAsset(themeId, {
      kind: 'website',
      name: 'panel',
      data: { mode: 'external', url: 'https://example.com/panel' },
    });
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/command`, {
      type: 'playBgm',
      bgmId,
      playerId,
      loop: true,
      waitUntilEnd: false,
    });
    await waitFor(() => transport.ofType('play').length === 1);
    const play = transport.ofType('play')[0];
    await waitFor(() => (transport.media.at(-1)?.playing.length ?? 0) === 1);
    expect(transport.media.at(-1)!.playing[0]).toMatchObject({
      commandId: play.wire.id,
      deviceId,
      channel: 'bgm',
      playerId,
      assetId: bgmId,
      assetName: 'ambient',
      loop: true,
    });

    // Looping BGM acks on playback start — the entry must survive it.
    runtime.handleAck(sessionId, deviceId, {
      commandId: play.wire.id,
      status: 'done',
    });
    expect(transport.media.at(-1)!.playing).toHaveLength(1);

    // navigate is tracked as the device's current website
    await post(`/api/sessions/${sessionId}/command`, {
      type: 'navigate',
      deviceId,
      websiteId,
      query: [],
    });
    await waitFor(() => (transport.media.at(-1)?.websites.length ?? 0) === 1);
    expect(transport.media.at(-1)!.websites[0]).toMatchObject({
      deviceId,
      websiteId,
      url: 'https://example.com/panel',
    });

    // stopBgm ends the tracked playback (the admin force-stop path)
    await post(`/api/sessions/${sessionId}/command`, {
      type: 'stopBgm',
      playerId,
      allPlayers: false,
    });
    await waitFor(() => transport.media.at(-1)?.playing.length === 0);
    expect(transport.media.at(-1)!.websites).toHaveLength(1);

    // resetDevice clears the website (the admin website-terminate path)
    await post(`/api/sessions/${sessionId}/command`, {
      type: 'resetDevice',
      deviceId,
    });
    await waitFor(() => transport.media.at(-1)?.websites.length === 0);

    const logs = await getLogs(sessionId);
    expect(
      logs.filter((l) => l.message.startsWith('Admin command:')).length,
    ).toBe(4);
  });
});
