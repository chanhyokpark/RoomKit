import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SessionState, Welcome, WireCommand } from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectDevice,
  createSocketTestApp,
  login,
  waitForConnectError,
  waitForEvent,
} from './helpers';

describe('Device gateway (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let token: string;
  const sockets: Socket[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    ({ app, url } = await createSocketTestApp());
    token = await login(app);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    for (const id of sessionIds) {
      await auth(request(app.getHttpServer()).post(`/api/sessions/${id}/end`));
    }
    await app.close();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  function device(code: string): Socket {
    const socket = connectDevice(url, code);
    sockets.push(socket);
    return socket;
  }

  async function post(path: string, body?: object) {
    const res = await auth(request(server()).post(path).send(body ?? {}));
    if (res.status >= 400) {
      throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function createTheme(timeLimitMs: number | null = null): Promise<string> {
    return (await post('/api/themes', { name: 'gateway e2e', timeLimitMs })).id;
  }

  async function createAsset(themeId: string, input: object): Promise<string> {
    return (await post(`/api/themes/${themeId}/assets`, input)).id;
  }

  const entry = (cmd: object) => ({ id: randomUUID(), ...cmd });

  async function getLogs(sessionId: string) {
    const res = await auth(
      request(server()).get(`/api/sessions/${sessionId}/logs?limit=500`),
    ).expect(200);
    return res.body as { kind: string; level: string; message: string }[];
  }

  /** Theme with one self-player device and a session:start → playBgm event. */
  async function fixture() {
    const themeId = await createTheme();
    const deviceId = await createAsset(themeId, {
      kind: 'device',
      name: 'main-device',
      code: `prod-${randomUUID().slice(0, 8)}`,
      data: { displayName: '메인 장치' },
    });
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main-player',
      data: { speakerDeviceId: deviceId, screenDeviceId: deviceId, subtitleCss: '' },
    });
    const bgmId = await createAsset(themeId, {
      kind: 'bgm',
      name: 'ambient',
      data: { fileKey: 'themes/test/ambient.mp3' },
    });
    await createAsset(themeId, {
      kind: 'event',
      name: 'start-bgm',
      data: {
        phaseId: null,
        triggerKind: 'system',
        triggerName: 'session:start',
        manualTriggerable: false,
        allowReentry: false,
        sequence: [entry({ type: 'playBgm', bgmId, playerId, loop: true })],
      },
    });
    await createAsset(themeId, {
      kind: 'event',
      name: 'bgm-on-demand',
      data: {
        phaseId: null,
        triggerKind: 'device',
        triggerName: 'more-bgm',
        manualTriggerable: false,
        allowReentry: true,
        sequence: [entry({ type: 'playBgm', bgmId, playerId, loop: false })],
      },
    });
    return { themeId, deviceId, playerId, bgmId };
  }

  async function createTestSession(themeId: string) {
    const session = await post('/api/sessions', { themeId, mode: 'test' });
    sessionIds.push(session.id as string);
    return session as {
      id: string;
      testDeviceCodes: { deviceId: string; code: string }[];
    };
  }

  it('attaches with a test code, receives welcome and redelivered commands', async () => {
    const { themeId, deviceId } = await fixture();
    const session = await createTestSession(themeId);
    const code = session.testDeviceCodes.find((c) => c.deviceId === deviceId)!.code;

    // session:start already ran while the device was offline → bgm logged failed
    await new Promise((r) => setTimeout(r, 200));
    const preLogs = await getLogs(session.id);
    expect(preLogs.some((l) => l.message.includes('device offline'))).toBe(true);

    const socket = device(code);
    const welcome = await waitForEvent<Welcome>(socket, 'welcome');
    expect(welcome.device).toMatchObject({
      id: deviceId,
      name: 'main-device',
      displayName: '메인 장치',
    });
    expect(welcome.session).toMatchObject({
      sessionId: session.id,
      mode: 'test',
      state: 'running',
    });
  });

  it('delivers commands with playable presigned urls and enforces waitUntilEnd ordering', async () => {
    const { themeId, deviceId, playerId } = await fixture();
    const dialogueId = await createAsset(themeId, {
      kind: 'dialogue',
      name: 'talk',
      data: {
        keepSubtitleAfterEnd: true,
        lines: [{ id: randomUUID(), fileKey: 'themes/test/line1.mp3', subtitleHtml: 'hi' }],
      },
    });
    const messageId = await createAsset(themeId, {
      kind: 'message',
      name: 'after-talk',
      data: {
        displayName: 'after-talk',
        fields: [{ key: 'ok', label: 'OK', type: 'boolean', required: true }],
      },
    });
    await createAsset(themeId, {
      kind: 'event',
      name: 'talk-then-message',
      data: {
        phaseId: null,
        triggerKind: 'device',
        triggerName: 'button',
        manualTriggerable: false,
        allowReentry: false,
        sequence: [
          entry({ type: 'playDialogue', dialogueId, playerId, waitUntilEnd: true }),
          entry({ type: 'sendMessage', deviceId, messageId, values: { ok: true } }),
        ],
      },
    });
    const session = await createTestSession(themeId);
    const code = session.testDeviceCodes.find((c) => c.deviceId === deviceId)!.code;

    const socket = device(code);
    await waitForEvent(socket, 'welcome');

    const received: WireCommand[] = [];
    socket.on('command', (cmd: WireCommand) => received.push(cmd));

    // on-demand bgm proves live delivery with a playable presigned url
    socket.emit('trigger', { event: 'more-bgm' });
    await waitForEvent(socket, 'command');
    const bgm = received.find((c) => c.type === 'play')! as WireCommand & { url: string };
    expect(bgm).toMatchObject({ type: 'play', channel: 'bgm', loop: false });
    expect(bgm.url).toContain('ambient.mp3');
    socket.emit('ack', { commandId: bgm.id, status: 'done' });
    received.length = 0;

    socket.emit('trigger', { event: 'button' });

    // dialogue arrives; the message must wait for the ack
    await new Promise((r) => setTimeout(r, 300));
    const dialogue = received.find((c) => c.type === 'play');
    expect(dialogue).toMatchObject({ channel: 'dialogue', role: 'both' });
    expect(
      (dialogue as { lines: { url: string; subtitleHtml: string }[] }).lines[0],
    ).toMatchObject({ subtitleHtml: 'hi' });
    expect(received.some((c) => c.type === 'message')).toBe(false);

    const messagePromise = waitForEvent<WireCommand>(socket, 'command');
    socket.emit('ack', { commandId: dialogue!.id, status: 'done' });
    const message = await messagePromise;
    expect(message).toMatchObject({
      type: 'message',
      messageName: 'after-talk',
      payload: { ok: true },
    });
    // duplicate ack is harmless
    socket.emit('ack', { commandId: dialogue!.id, status: 'done' });
  });

  it('redelivers unacked commands with the same id on reconnect', async () => {
    const { themeId, deviceId } = await fixture();
    const session = await createTestSession(themeId);
    const code = session.testDeviceCodes.find((c) => c.deviceId === deviceId)!.code;

    const first = device(code);
    await waitForEvent(first, 'welcome');
    const bgmPromise = waitForEvent<WireCommand>(first, 'command');
    first.emit('trigger', { event: 'more-bgm' });
    const bgm = await bgmPromise;
    expect(bgm.type).toBe('play');
    first.disconnect(); // never acked

    const second = device(code);
    const redelivered = await waitForEvent<WireCommand>(second, 'command');
    expect(redelivered.id).toBe(bgm.id);
  });

  it('rejects bad codes and codes of ended sessions as fatal', async () => {
    const { themeId, deviceId } = await fixture();
    expect(await waitForConnectError(device('tst_nonexistent1'))).toBe('invalid_code');
    expect(await waitForConnectError(device('no-such-production-code-x'))).toBe(
      'invalid_code',
    );

    const session = await createTestSession(themeId);
    const code = session.testDeviceCodes.find((c) => c.deviceId === deviceId)!.code;
    await post(`/api/sessions/${session.id}/end`);
    expect(await waitForConnectError(device(code))).toBe('session_ended');
  });

  it('parks production devices in the lobby and sweeps them into a new session', async () => {
    const { themeId, deviceId } = await fixture();
    const prodCode = (
      await auth(request(server()).get(`/api/themes/${themeId}/assets/${deviceId}`))
    ).body.code as string;

    // no active production session yet → lobby (connected, no welcome)
    const socket = device(prodCode);
    await waitForEvent(socket, 'connect');
    const early = waitForEvent<Welcome>(socket, 'welcome', 500).catch(() => null);
    expect(await early).toBeNull();

    // the welcome/command arrive DURING the POST — listen before acting
    const welcomePromise = waitForEvent<Welcome>(socket, 'welcome');
    const commandPromise = waitForEvent<WireCommand>(socket, 'command');
    const session = await post('/api/sessions', { themeId, mode: 'production' });
    sessionIds.push(session.id as string);
    const welcome = await welcomePromise;
    expect(welcome.session).toMatchObject({ sessionId: session.id, mode: 'production' });
    // swept in before session:start fired → the bgm command arrives live
    const cmd = await commandPromise;
    expect(cmd.type).toBe('play');
  });

  it('broadcasts session:state on pause/resume with timer snapshots', async () => {
    const { themeId, deviceId } = await fixture();
    const session = await createTestSession(themeId);
    const code = session.testDeviceCodes.find((c) => c.deviceId === deviceId)!.code;
    const socket = device(code);
    await waitForEvent(socket, 'welcome');

    const statePromise = waitForEvent<SessionState>(socket, 'session:state');
    await post(`/api/sessions/${session.id}/pause`);
    const state = await statePromise;
    expect(state).toMatchObject({ sessionId: session.id, state: 'paused' });

    const resumePromise = waitForEvent<SessionState>(socket, 'session:state');
    await post(`/api/sessions/${session.id}/resume`);
    expect((await resumePromise).state).toBe('running');
  });
});
