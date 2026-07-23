import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PlayerStatus, PlayerTestStart, Welcome } from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectAdmin,
  connectDevice,
  connectPlayer,
  createSocketTestApp,
  login,
  waitForConnectError,
  waitForEvent,
} from './helpers';

describe('Player gateway (e2e)', () => {
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

  function track<T extends Socket>(socket: T): T {
    sockets.push(socket);
    return socket;
  }

  async function post(path: string, body?: object) {
    const res = await auth(
      request(server())
        .post(path)
        .send(body ?? {}),
    );
    return res;
  }

  /** Theme with two devices. */
  async function fixture() {
    const theme = await post('/api/themes', {
      name: 'player e2e',
      timeLimitMs: null,
    });
    const themeId = theme.body.id as string;
    const deviceIds: string[] = [];
    for (const name of ['screen', 'speaker']) {
      const res = await post(`/api/themes/${themeId}/assets`, {
        kind: 'device',
        name,
        code: `prod-${randomUUID().slice(0, 8)}`,
        data: { displayName: name },
      });
      deviceIds.push(res.body.id as string);
    }
    return { themeId, deviceIds };
  }

  it('rejects a handshake without a valid identity', async () => {
    const bad = track(connectPlayer(url, 'not-a-uuid', '플레이어-test'));
    expect(await waitForConnectError(bad)).toBe('invalid_player');
  });

  it('broadcasts player:status to admins on connect and disconnect', async () => {
    const playerId = randomUUID();
    const admin = track(connectAdmin(url, token));
    await waitForEvent(admin, 'connect');

    const onlinePromise = waitForEvent<PlayerStatus>(admin, 'player:status');
    const player = track(connectPlayer(url, playerId, '플레이어-abcd'));
    expect(await onlinePromise).toEqual({
      playerId,
      playerName: '플레이어-abcd',
      online: true,
    });

    // A fresh admin connection gets the online player in its initial dump.
    const admin2 = track(connectAdmin(url, token));
    const dumped = await waitForEvent<PlayerStatus>(admin2, 'player:status');
    expect(dumped).toMatchObject({ playerId, online: true });

    const offlinePromise = waitForEvent<PlayerStatus>(admin, 'player:status');
    player.disconnect();
    expect(await offlinePromise).toMatchObject({ playerId, online: false });
  });

  it('creating a test session with playerId generates codes and pushes test:start', async () => {
    const { themeId, deviceIds } = await fixture();
    const playerId = randomUUID();
    const player = track(connectPlayer(url, playerId, '플레이어-e2e'));
    await waitForEvent(player, 'connect');

    const startPromise = waitForEvent<PlayerTestStart>(player, 'test:start');
    const res = await post('/api/sessions', {
      themeId,
      mode: 'test',
      playerId,
    });
    expect(res.status).toBe(201);
    sessionIds.push(res.body.id as string);

    const codes = res.body.testDeviceCodes as {
      deviceId: string;
      code: string;
    }[];
    expect(codes.map((c) => c.deviceId).toSorted()).toEqual(
      deviceIds.toSorted(),
    );
    for (const c of codes) expect(c.code).toMatch(/^[a-z2-9]{6}$/);

    const start = await startPromise;
    expect(start.sessionId).toBe(res.body.id);
    expect(start.themeId).toBe(themeId);
    expect(start.devices.map((d) => d.code).toSorted()).toEqual(
      codes.map((c) => c.code).toSorted(),
    );

    // The pushed codes actually attach devices to the session.
    const device = track(connectDevice(url, start.devices[0].code));
    const welcome = await waitForEvent<Welcome>(device, 'welcome');
    expect(welcome.session.sessionId).toBe(res.body.id);
  });

  it('rejects playerId for offline players, production mode, and alongside deviceCodes', async () => {
    const { themeId, deviceIds } = await fixture();
    const offline = await post('/api/sessions', {
      themeId,
      mode: 'test',
      playerId: randomUUID(),
    });
    expect(offline.status).toBe(400);

    const playerId = randomUUID();
    const player = track(connectPlayer(url, playerId, '플레이어-e2e'));
    await waitForEvent(player, 'connect');

    const production = await post('/api/sessions', {
      themeId,
      mode: 'production',
      playerId,
    });
    expect(production.status).toBe(400);

    const both = await post('/api/sessions', {
      themeId,
      mode: 'test',
      playerId,
      deviceCodes: [{ deviceId: deviceIds[0], code: 'x' }],
    });
    expect(both.status).toBe(400);
  });
});
