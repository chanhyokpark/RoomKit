import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { WireCommand } from '@roomkit/shared';
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
  offline = new Set<string>();

  sendCommand(sessionId: string, deviceId: string, wire: WireCommand): boolean {
    if (this.offline.has(deviceId)) return false;
    this.sent.push({ sessionId, deviceId, wire });
    return true;
  }
  sendProgress(): void {}
  broadcastSessionState(): void {}
  broadcastLog(): void {}
  broadcastDeviceStatus(): void {}

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
    const res = await auth(request(server()).post(path).send(body ?? {}));
    if (res.status >= 400) {
      throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function createTheme(timeLimitMs: number | null = null): Promise<string> {
    const body = await post('/api/themes', { name: 'runtime e2e', timeLimitMs });
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
    const body = await post('/api/sessions', { themeId, mode: 'test' });
    sessionIds.push(body.id as string);
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
        entry({ type: 'eval', code: 'ctx.vars.count = 41 + 1; ctx.log("from eval");' }),
        entry({ type: 'eval', code: 'ctx.vars.count === 42 ? false : true' }),
        entry({ type: 'sendMessage', deviceId, messageId, values: {} }),
      ],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message.includes('sequence stopped')),
    );
    const session = await auth(request(server()).get(`/api/sessions/${sessionId}`)).expect(200);
    expect(session.body.vars).toEqual({ count: 42 });
    const logs = await getLogs(sessionId);
    expect(logs.some((l) => l.kind === 'eval' && l.message === 'from eval')).toBe(true);
    // guard stopped the sequence before the message command
    expect(transport.ofType('message')).toHaveLength(0);
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
      sequence: [entry({ type: 'sendMessage', deviceId, messageId, values: {} })],
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
    const p1 = await createAsset(themeId, { kind: 'phase', name: 'P1', data: { order: 1 } });
    const p2 = await createAsset(themeId, { kind: 'phase', name: 'P2', data: { order: 2 } });
    await createEvent(themeId, 'on-leave-p1', {
      phaseId: p1,
      triggerKind: 'system',
      triggerName: 'phase:leave',
      sequence: [entry({ type: 'eval', code: 'ctx.log("leaving P1 in " + ctx.phase)' })],
    });
    await createEvent(themeId, 'on-enter-p2', {
      phaseId: p2,
      triggerKind: 'system',
      triggerName: 'phase:enter',
      sequence: [entry({ type: 'eval', code: 'ctx.log("entered P2 in " + ctx.phase)' })],
    });
    const sessionId = await createSession(themeId);
    expect((await auth(request(server()).get(`/api/sessions/${sessionId}`))).body.phaseId).toBe(p1);

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

    const session = await auth(request(server()).get(`/api/sessions/${sessionId}`)).expect(200);
    expect(session.body.phaseId).toBe(p2);
  });

  it('enforces the phase guard for device triggers', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'dev');
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'msg',
      data: { displayName: 'msg', fields: [] },
    });
    const p1 = await createAsset(themeId, { kind: 'phase', name: 'P1', data: { order: 1 } });
    const p2 = await createAsset(themeId, { kind: 'phase', name: 'P2', data: { order: 2 } });
    void p1;
    await createEvent(themeId, 'p2-only', {
      phaseId: p2,
      triggerKind: 'device',
      triggerName: 'btn',
      sequence: [entry({ type: 'sendMessage', deviceId, messageId, values: {} })],
    });
    const sessionId = await createSession(themeId); // starts in P1
    runtime.handleDeviceTrigger(sessionId, deviceId, { event: 'btn' });

    await waitFor(async () =>
      (await getLogs(sessionId)).some((l) => l.message.includes('out of phase')),
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
      sequence: [entry({ type: 'sendMessage', deviceId, messageId, values: {} })],
    });
    const callerId = await createEvent(themeId, 'caller', {
      sequence: [entry({ type: 'callEvent', eventId: calleeId })],
    });
    // self-recursion; allowReentry so only the depth limit stops it
    const bombId = await createEvent(themeId, 'bomb', { allowReentry: true, sequence: [] });
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

  it('waitUntilEnd blocks until the ack and offline devices do not block', async () => {
    const themeId = await createTheme();
    const speakerId = await createDevice(themeId, 'speaker');
    const otherId = await createDevice(themeId, 'other');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: { speakerDeviceId: speakerId, screenDeviceId: speakerId, subtitleCss: '' },
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
        entry({ type: 'sendMessage', deviceId: otherId, messageId, values: {} }),
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

    runtime.handleAck(sessionId, speakerId, { commandId: play.wire.id, status: 'done' });
    await waitFor(() => transport.ofType('message').length === 1);
    // duplicate ack is harmless
    runtime.handleAck(sessionId, speakerId, { commandId: play.wire.id, status: 'done' });

    // offline device: logged, sequence continues immediately
    transport.offline.add(speakerId);
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
      data: { speakerDeviceId: speakerId, screenDeviceId: screenId, subtitleCss: '.s{}' },
    });
    const dialogueId = await createAsset(themeId, {
      kind: 'dialogue',
      name: 'talk',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [
          { id: randomUUID(), fileKey: 'themes/test/l1.mp3', subtitleHtml: '<b>1</b>' },
          { id: randomUUID(), fileKey: 'themes/test/l2.mp3', subtitleHtml: '<b>2</b>' },
        ],
      },
    });
    const eventId = await createEvent(themeId, 'talk', {
      sequence: [entry({ type: 'playDialogue', dialogueId, playerId, waitUntilEnd: false })],
    });
    const sessionId = await createSession(themeId);
    await post(`/api/sessions/${sessionId}/trigger`, { eventId });

    await waitFor(() => transport.ofType('play').length === 2);
    const bySpeaker = transport.ofType('play').find((s) => s.deviceId === speakerId);
    const byScreen = transport.ofType('play').find((s) => s.deviceId === screenId);
    expect(bySpeaker?.wire).toMatchObject({ channel: 'dialogue', role: 'speaker' });
    expect(byScreen?.wire).toMatchObject({
      channel: 'dialogue',
      role: 'screen',
      subtitleCss: '.s{}',
    });
    expect((byScreen!.wire as { lines: unknown[] }).lines).toHaveLength(2);
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
      sequence: [entry({ type: 'sendMessage', deviceId, messageId, values: {} })],
    });
    const sessionId = await createSession(themeId);

    await waitFor(() => transport.ofType('message').length === 1, 3000);
    const session = await auth(request(server()).get(`/api/sessions/${sessionId}`)).expect(200);
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
      (await getLogs(session2)).some((l) => l.message.includes('"setter" finished')),
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
      (await getLogs(session2)).some((l) => l.message.includes('Runtime restarted')),
    );

    // the recovered engine still runs sequences
    await post(`/api/sessions/${session2}/trigger`, { eventId: evalEventId });
    await waitFor(async () =>
      (await getLogs(session2)).filter((l) => l.message.includes('"setter" finished'))
        .length >= 2,
    );
  });
});
