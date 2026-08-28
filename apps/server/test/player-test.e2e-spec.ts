import { INestApplication } from '@nestjs/common';
import type { PlayerTestStart, WireCommand } from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectAdmin,
  connectDevice,
  connectPlayer,
  createSocketTestApp,
  login,
  nextTestCode,
  waitForEvent,
} from './helpers';

/**
 * Player-side testing features: device subset codes, session URL overrides,
 * device starting webpages, test callbacks, and the helper:info relay.
 */
describe('Player test sessions (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let token: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ({ app, url } = await createSocketTestApp());
    token = await login(app);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  function track<T extends Socket>(socket: T): T {
    sockets.push(socket);
    return socket;
  }

  async function createTheme(): Promise<string> {
    const res = await auth(
      request(server())
        .post('/api/themes')
        .send({ name: 'player-test e2e', timeLimitMs: null }),
    ).expect(201);
    return res.body.id as string;
  }

  async function createDevice(
    themeId: string,
    name: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({
          kind: 'device',
          name,
          code: nextTestCode(),
          data: { displayName: `Device ${name}`, ...data },
        }),
    ).expect(201);
    return res.body.id as string;
  }

  async function createWebsite(themeId: string, name: string, siteUrl: string) {
    const res = await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({
          kind: 'website',
          name,
          data: { mode: 'external', url: siteUrl },
        }),
    ).expect(201);
    return res.body.id as string;
  }

  it('mints codes for the selected device subset and pushes test:start', async () => {
    const themeId = await createTheme();
    const devA = await createDevice(themeId, 'subset-a');
    await createDevice(themeId, 'subset-b');
    const websiteId = await createWebsite(themeId, 'site', 'http://site.example/');

    const playerId = crypto.randomUUID();
    const player = track(connectPlayer(url, playerId, 'e2e player'));
    await waitForEvent(player, 'connect');

    const testStart = waitForEvent<PlayerTestStart>(player, 'test:start');
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          playerId,
          deviceIds: [devA],
          urlOverrides: [{ websiteId, url: 'http://localhost:5175/' }],
        }),
    ).expect(201);

    expect(created.body.testDeviceCodes).toHaveLength(1);
    expect(created.body.testDeviceCodes[0].deviceId).toBe(devA);
    expect(created.body.urlOverrides).toEqual({
      [websiteId]: 'http://localhost:5175/',
    });
    const pushed = await testStart;
    expect(pushed.sessionId).toBe(created.body.id);
    expect(pushed.devices).toHaveLength(1);

    await auth(
      request(server()).post(`/api/sessions/${created.body.id}/end`),
    ).expect(201);
  });

  it('validates deviceIds and urlOverrides', async () => {
    const themeId = await createTheme();
    await createDevice(themeId, 'val-a');
    const playerId = crypto.randomUUID();
    const player = track(connectPlayer(url, playerId, 'e2e player'));
    await waitForEvent(player, 'connect');

    // deviceIds requires playerId
    await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [], deviceIds: [crypto.randomUUID()] }),
    ).expect(400);
    // unknown device id
    await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', playerId, deviceIds: [crypto.randomUUID()] }),
    ).expect(400);
    // unknown override website
    await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          playerId,
          urlOverrides: [{ websiteId: crypto.randomUUID(), url: 'http://x/' }],
        }),
    ).expect(400);
    // overrides are test-only
    await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'production',
          urlOverrides: [{ websiteId: crypto.randomUUID(), url: 'http://x/' }],
        }),
    ).expect(400);
  });

  it('applies urlOverrides when resolving navigate commands', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'nav-dev');
    const websiteId = await createWebsite(themeId, 'nav-site', 'http://original.example/page');
    const code = nextTestCode();

    const withOverrides = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [{ deviceId, code }],
          urlOverrides: [{ websiteId, url: 'http://localhost:5175/dev' }],
        }),
    ).expect(201);
    const sessionId = withOverrides.body.id as string;

    const device = track(connectDevice(url, code));
    await waitForEvent(device, 'welcome');
    await auth(request(server()).post(`/api/sessions/${sessionId}/start`)).expect(201);

    const wire = waitForEvent<WireCommand>(device, 'command');
    await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/command`)
        .send({
          type: 'navigate',
          deviceId,
          websiteId,
          query: [{ key: 'k', value: 'v' }],
        }),
    ).expect(204);
    const navigate = await wire;
    expect(navigate.type).toBe('navigate');
    if (navigate.type === 'navigate') {
      expect(navigate.url).toBe('http://localhost:5175/dev?k=v');
    }

    await auth(request(server()).post(`/api/sessions/${sessionId}/end`)).expect(201);
  });

  it('navigates devices to their starting webpage on start and on late attach', async () => {
    const themeId = await createTheme();
    const websiteId = await createWebsite(themeId, 'start-site', 'http://start.example/');
    const devEarly = await createDevice(themeId, 'start-early', {
      startWebsite: { websiteId, query: [{ key: 'room', value: 'alpha' }] },
    });
    const devLate = await createDevice(themeId, 'start-late', {
      startWebsite: { websiteId, query: [] },
    });
    const codeEarly = nextTestCode();
    const codeLate = nextTestCode();

    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [
            { deviceId: devEarly, code: codeEarly },
            { deviceId: devLate, code: codeLate },
          ],
        }),
    ).expect(201);
    const sessionId = created.body.id as string;

    // devEarly is online before start — receives its start website on start.
    const early = track(connectDevice(url, codeEarly));
    await waitForEvent(early, 'welcome');
    const earlyWire = waitForEvent<WireCommand>(early, 'command');
    await auth(request(server()).post(`/api/sessions/${sessionId}/start`)).expect(201);
    const earlyNavigate = await earlyWire;
    expect(earlyNavigate.type).toBe('navigate');
    if (earlyNavigate.type === 'navigate') {
      expect(earlyNavigate.url).toBe('http://start.example/?room=alpha');
    }

    // devLate attaches mid-session with nothing showing — navigated on attach.
    const late = track(connectDevice(url, codeLate));
    const lateWire = waitForEvent<WireCommand>(late, 'command');
    const lateNavigate = await lateWire;
    expect(lateNavigate.type).toBe('navigate');
    if (lateNavigate.type === 'navigate') {
      expect(lateNavigate.url).toBe('http://start.example/');
    }

    await auth(request(server()).post(`/api/sessions/${sessionId}/end`)).expect(201);
  });

  it('runs test callbacks through the device ack and rejects production sessions', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'cb-dev');
    const code = nextTestCode();
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [{ deviceId, code }] }),
    ).expect(201);
    const sessionId = created.body.id as string;

    const device = track(connectDevice(url, code));
    await waitForEvent(device, 'welcome');

    // Ack 'done' for the known name, 'failed' otherwise (helper contract).
    device.on('command', (wire: WireCommand) => {
      if (wire.type !== 'testCallback') return;
      device.emit('ack', {
        commandId: wire.id,
        status: wire.name === 'reset-puzzle' ? 'done' : 'failed',
      });
    });

    const okRes = await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/devices/${deviceId}/test-callback`)
        .send({ name: 'reset-puzzle' }),
    ).expect(201);
    expect(okRes.body).toEqual({ ok: true });

    const failRes = await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/devices/${deviceId}/test-callback`)
        .send({ name: 'unknown' }),
    ).expect(201);
    expect(failRes.body).toEqual({ ok: false });

    // Offline device → ok:false immediately.
    device.disconnect();
    const offlineRes = await auth(
      request(server())
        .post(`/api/sessions/${sessionId}/devices/${deviceId}/test-callback`)
        .send({ name: 'reset-puzzle' }),
    ).expect(201);
    expect(offlineRes.body).toEqual({ ok: false });

    await auth(request(server()).post(`/api/sessions/${sessionId}/end`)).expect(201);

    // Production sessions reject test callbacks.
    const prod = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'production' }),
    ).expect(201);
    await auth(
      request(server())
        .post(`/api/sessions/${prod.body.id}/devices/${deviceId}/test-callback`)
        .send({ name: 'reset-puzzle' }),
    ).expect(400);
    await auth(request(server()).post(`/api/sessions/${prod.body.id}/end`)).expect(201);
  });

  it('relays helper-registered message and callback names via device:status', async () => {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'helper-dev');
    const code = nextTestCode();
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [{ deviceId, code }] }),
    ).expect(201);
    const sessionId = created.body.id as string;

    const admin = track(connectAdmin(url, token));
    await waitForEvent(admin, 'connect');
    const device = track(connectDevice(url, code));
    await waitForEvent(device, 'welcome');

    const statusPromise = new Promise<{
      helperMessages?: string[] | null;
      helperTestCallbacks?: string[] | null;
    }>((resolve) => {
      admin.on(
        'device:status',
        (status: {
          sessionId: string;
          deviceId: string;
          helperMessages?: string[] | null;
          helperTestCallbacks?: string[] | null;
        }) => {
          if (
            status.sessionId === sessionId &&
            status.deviceId === deviceId &&
            status.helperMessages != null
          ) {
            resolve(status);
          }
        },
      );
    });

    device.emit('helper:info', {
      version: '0.4.0',
      messages: ['unlock', 'announce'],
      testCallbacks: ['reset-puzzle'],
    });

    const status = await statusPromise;
    expect(status.helperMessages).toEqual(['unlock', 'announce']);
    expect(status.helperTestCallbacks).toEqual(['reset-puzzle']);

    await auth(request(server()).post(`/api/sessions/${sessionId}/end`)).expect(201);
  });
});
