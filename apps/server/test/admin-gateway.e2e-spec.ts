import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  DeviceStatus,
  SessionLogEntry,
  SessionState,
} from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectAdmin,
  connectDevice,
  createSocketTestApp,
  login,
  nextTestCode,
  waitForConnectError,
  waitForEvent,
} from './helpers';

describe('Admin gateway (e2e)', () => {
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

  function admin(t: string): Socket {
    const socket = connectAdmin(url, t);
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

  async function waitUntil(
    condition: () => boolean,
    timeoutMs = 3000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('waitUntil timed out');
  }

  async function fixture() {
    const themeId = (
      await post('/api/themes', { name: 'admin e2e', timeLimitMs: null })
    ).id as string;
    const deviceId = (
      await post(`/api/themes/${themeId}/assets`, {
        kind: 'device',
        name: 'admin-dev',
        code: `adm-${randomUUID().slice(0, 8)}`,
        data: { displayName: '관리 장치' },
      })
    ).id as string;
    return { themeId, deviceId };
  }

  it('rejects a missing or invalid token', async () => {
    expect(await waitForConnectError(admin('garbage-token'))).toBe(
      'unauthorized',
    );
    const noAuth = connectAdmin(url, '');
    sockets.push(noAuth);
    expect(await waitForConnectError(noAuth)).toBe('unauthorized');
  });

  it('streams session state, logs, and device status to authenticated admins', async () => {
    const { themeId, deviceId } = await fixture();
    const socket = admin(token);
    await waitForEvent(socket, 'connect');

    const states: SessionState[] = [];
    const logs: SessionLogEntry[] = [];
    const statuses: DeviceStatus[] = [];
    socket.on('session:state', (s: SessionState) => states.push(s));
    socket.on('log', (l: SessionLogEntry) => logs.push(l));
    socket.on('device:status', (d: DeviceStatus) => statuses.push(d));

    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [{ deviceId, code: nextTestCode() }],
    });
    sessionIds.push(session.id as string);
    const code = session.testDeviceCodes.find(
      (c: { deviceId: string }) => c.deviceId === deviceId,
    ).code as string;

    // creation broadcasts the idle state; starting broadcasts running + a log
    await waitUntil(() =>
      states.some((s) => s.sessionId === session.id && s.state === 'created'),
    );
    await post(`/api/sessions/${session.id}/start`);
    await waitUntil(
      () =>
        states.some(
          (s) => s.sessionId === session.id && s.state === 'running',
        ) &&
        logs.some(
          (l) => l.sessionId === session.id && l.message === 'Session started',
        ),
    );

    // device connect → online status; disconnect → offline
    const deviceSocket = connectDevice(url, code);
    sockets.push(deviceSocket);
    await waitForEvent(deviceSocket, 'welcome');
    await waitUntil(() =>
      statuses.some(
        (d) =>
          d.sessionId === session.id &&
          d.deviceId === deviceId &&
          d.deviceName === 'admin-dev' &&
          d.online,
      ),
    );

    deviceSocket.disconnect();
    await waitUntil(() =>
      statuses.some((d) => d.deviceId === deviceId && !d.online),
    );

    // pause is broadcast too
    const pausePromise = waitForEvent<SessionState>(socket, 'session:state');
    await post(`/api/sessions/${session.id}/pause`);
    expect((await pausePromise).state).toBe('paused');
  });

  it('sends an initial dump of live sessions and online devices on connect', async () => {
    const { themeId, deviceId } = await fixture();
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [{ deviceId, code: nextTestCode() }],
    });
    sessionIds.push(session.id as string);
    await post(`/api/sessions/${session.id}/start`);
    const code = session.testDeviceCodes.find(
      (c: { deviceId: string }) => c.deviceId === deviceId,
    ).code as string;
    const deviceSocket = connectDevice(url, code);
    sockets.push(deviceSocket);
    await waitForEvent(deviceSocket, 'welcome');

    // a late-joining admin sees the existing world without touching REST
    const socket = admin(token);
    const states: SessionState[] = [];
    const statuses: DeviceStatus[] = [];
    socket.on('session:state', (s: SessionState) => states.push(s));
    socket.on('device:status', (d: DeviceStatus) => statuses.push(d));
    await waitForEvent(socket, 'device:status');

    expect(states.some((s) => s.sessionId === session.id)).toBe(true);
    expect(
      statuses.some(
        (d) =>
          d.sessionId === session.id && d.deviceId === deviceId && d.online,
      ),
    ).toBe(true);
  });
});
