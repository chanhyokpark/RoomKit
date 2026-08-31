import { INestApplication } from '@nestjs/common';
import type { HintError, HintShow, SessionLogEntry } from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectAdmin,
  connectDevice,
  createSocketTestApp,
  login,
  nextTestCode,
  waitForEvent,
} from './helpers';

describe('Hint flow (e2e)', () => {
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

  async function createAsset(themeId: string, input: object): Promise<string> {
    return (await post(`/api/themes/${themeId}/assets`, input)).id;
  }

  async function getLogs(sessionId: string) {
    const res = await auth(
      request(server()).get(`/api/sessions/${sessionId}/logs?limit=500`),
    ).expect(200);
    return res.body as { kind: string; level: string; message: string }[];
  }

  const HINT_CODE = '0417';

  /** Theme with a hint device, a regular device, and a 2-step hint. */
  async function fixture(opts: { hintDevice?: boolean } = {}) {
    const themeId = (
      await post('/api/themes', { name: 'hints e2e', timeLimitMs: null })
    ).id as string;
    const hintDeviceId = await createAsset(themeId, {
      kind: 'device',
      name: 'hint-device',
      code: `hint-${Math.random().toString(36).slice(2, 10)}`,
      data: { displayName: '힌트 장치', isHintDevice: opts.hintDevice ?? true },
    });
    const regularDeviceId = await createAsset(themeId, {
      kind: 'device',
      name: 'regular-device',
      code: `reg-${Math.random().toString(36).slice(2, 10)}`,
      data: { displayName: '일반 장치' },
    });
    const hintId = await createAsset(themeId, {
      kind: 'hint',
      name: 'first-puzzle',
      code: HINT_CODE,
      data: {
        steps: [
          { textHtml: '<p>step one</p>', imageKey: null },
          { textHtml: '<p>step two</p>', imageKey: 'themes/test/hint2.png' },
        ],
        params: { accent: '#ff0000' },
      },
    });
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [
        { deviceId: hintDeviceId, code: nextTestCode() },
        { deviceId: regularDeviceId, code: nextTestCode() },
      ],
    });
    sessionIds.push(session.id as string);
    await post(`/api/sessions/${session.id}/start`);
    const codeOf = (deviceId: string) =>
      (session.testDeviceCodes as { deviceId: string; code: string }[]).find(
        (c) => c.deviceId === deviceId,
      )!.code;
    return {
      themeId,
      hintId,
      sessionId: session.id as string,
      hintDeviceCode: codeOf(hintDeviceId),
      regularDeviceCode: codeOf(regularDeviceId),
    };
  }

  it('shows step 0 on code submit and advances statelessly via hint:next', async () => {
    const { sessionId, hintId, hintDeviceCode } = await fixture();
    const socket = device(hintDeviceCode);
    await waitForEvent(socket, 'welcome');

    const showPromise = waitForEvent<HintShow>(socket, 'hint:show');
    socket.emit('hint:submit', { code: HINT_CODE });
    const shown = await showPromise;
    expect(shown).toMatchObject({
      hintId,
      code: HINT_CODE,
      step: 0,
      stepCount: 2,
      textHtml: '<p>step one</p>',
      imageUrl: null,
      params: { accent: '#ff0000' },
    });

    const nextPromise = waitForEvent<HintShow>(socket, 'hint:show');
    socket.emit('hint:next', { hintId, step: 1 });
    const next = await nextPromise;
    expect(next).toMatchObject({
      hintId,
      step: 1,
      textHtml: '<p>step two</p>',
    });
    // presigned url for the step image
    expect(next.imageUrl).toContain('hint2.png');

    const logs = await getLogs(sessionId);
    const hintLogs = logs.filter((l) => l.kind === 'hint');
    expect(hintLogs.some((l) => l.message.includes('step 1/2'))).toBe(true);
    expect(hintLogs.some((l) => l.message.includes('step 2/2'))).toBe(true);
  });

  it('rejects wrong codes, bad steps, and unknown hint ids', async () => {
    const { hintId, hintDeviceCode, sessionId } = await fixture();
    const socket = device(hintDeviceCode);
    await waitForEvent(socket, 'welcome');

    const wrongPromise = waitForEvent<HintError>(socket, 'hint:error');
    socket.emit('hint:submit', { code: '9999' });
    expect(await wrongPromise).toMatchObject({
      reason: 'unknown_code',
      code: '9999',
    });

    const stepPromise = waitForEvent<HintError>(socket, 'hint:error');
    socket.emit('hint:next', { hintId, step: 5 });
    expect(await stepPromise).toMatchObject({ reason: 'invalid_step', hintId });

    const unknownPromise = waitForEvent<HintError>(socket, 'hint:error');
    socket.emit('hint:next', {
      hintId: '00000000-0000-4000-8000-000000000000',
      step: 0,
    });
    expect((await unknownPromise).reason).toBe('unknown_hint');

    const logs = await getLogs(sessionId);
    expect(
      logs.some(
        (l) => l.kind === 'hint' && l.message.includes('Wrong hint code'),
      ),
    ).toBe(true);
  });

  it('rejects submits from non-hint devices and from paused sessions', async () => {
    const { sessionId, hintDeviceCode, regularDeviceCode } = await fixture();

    const regular = device(regularDeviceCode);
    await waitForEvent(regular, 'welcome');
    const notHintPromise = waitForEvent<HintError>(regular, 'hint:error');
    regular.emit('hint:submit', { code: HINT_CODE });
    expect((await notHintPromise).reason).toBe('not_hint_device');

    const hintSocket = device(hintDeviceCode);
    await waitForEvent(hintSocket, 'welcome');
    await post(`/api/sessions/${sessionId}/pause`);
    const pausedPromise = waitForEvent<HintError>(hintSocket, 'hint:error');
    hintSocket.emit('hint:submit', { code: HINT_CODE });
    expect((await pausedPromise).reason).toBe('session_not_running');

    // resume restores the flow
    await post(`/api/sessions/${sessionId}/resume`);
    const showPromise = waitForEvent<HintShow>(hintSocket, 'hint:show');
    hintSocket.emit('hint:submit', { code: HINT_CODE });
    expect((await showPromise).step).toBe(0);
  });

  it('pushes hints from the admin API to the hint device', async () => {
    const { sessionId, hintId, hintDeviceCode } = await fixture();
    const socket = device(hintDeviceCode);
    await waitForEvent(socket, 'welcome');

    // default step 0
    const showPromise = waitForEvent<HintShow>(socket, 'hint:show');
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId }),
    ).expect(204);
    expect(await showPromise).toMatchObject({ hintId, step: 0 });

    // explicit step, while paused (operator judgment)
    await post(`/api/sessions/${sessionId}/pause`);
    const pausedShow = waitForEvent<HintShow>(socket, 'hint:show');
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId, step: 1 }),
    ).expect(204);
    expect(await pausedShow).toMatchObject({ hintId, step: 1 });
    await post(`/api/sessions/${sessionId}/resume`);

    // bad inputs
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId, step: 9 }),
    ).expect(400);
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId: '00000000-0000-4000-8000-000000000000' }),
    ).expect(400);
  });

  it('push with no hint device online still returns 204 and logs a warning', async () => {
    const { sessionId, hintId } = await fixture();
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId }),
    ).expect(204);
    const logs = await getLogs(sessionId);
    expect(
      logs.some(
        (l) =>
          l.kind === 'hint' &&
          l.level === 'warn' &&
          l.message.includes('no hint device is online'),
      ),
    ).toBe(true);
  });

  it('push to a theme with no hint device is a 400; ended session is a 404', async () => {
    const { sessionId, hintId } = await fixture({ hintDevice: false });
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId }),
    ).expect(400);

    await post(`/api/sessions/${sessionId}/end`);
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/hint`)
        .send({ hintId }),
    ).expect(404);
  });

  it('streams hint logs to the admin socket', async () => {
    const { sessionId, hintDeviceCode } = await fixture();
    const admin = connectAdmin(url, token);
    sockets.push(admin);
    await waitForEvent(admin, 'connect');

    const socket = device(hintDeviceCode);
    await waitForEvent(socket, 'welcome');

    const logPromise = new Promise<SessionLogEntry>((resolve) => {
      admin.on('log', (entry: SessionLogEntry) => {
        if (entry.sessionId === sessionId && entry.kind === 'hint')
          resolve(entry);
      });
    });
    socket.emit('hint:submit', { code: HINT_CODE });
    const entry = await logPromise;
    expect(entry.message).toContain(`Hint "${HINT_CODE}"`);
  });
});
