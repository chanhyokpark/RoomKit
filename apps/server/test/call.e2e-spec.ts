import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AdminCallState,
  CallActionAck,
  CallRequestAck,
  DeviceCallState,
  SessionLogEntry,
} from '@roomkit/shared';
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

/**
 * Voice-call signaling over socket.io (PeerJS media itself is out of scope).
 * Devices fake a helper website by reporting helper:info after their welcome.
 */
describe('Voice calls (e2e)', () => {
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

  async function post(path: string, body?: object): Promise<any> {
    const res = await auth(request(app.getHttpServer()).post(path)).send(body);
    if (res.status >= 400) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function get(path: string): Promise<any> {
    const res = await auth(request(app.getHttpServer()).get(path));
    if (res.status >= 400) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function waitUntil(
    condition: () => boolean,
    timeoutMs = 3000,
  ): Promise<void> {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs)
        throw new Error('waitUntil timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function fixture() {
    const themeId = (
      await post('/api/themes', { name: 'call e2e', timeLimitMs: null })
    ).id as string;
    const code = `call-${randomUUID().slice(0, 8)}`;
    const deviceId = (
      await post(`/api/themes/${themeId}/assets`, {
        kind: 'device',
        name: 'hintphone',
        code,
        data: { displayName: '힌트폰', isHintDevice: true },
      })
    ).id as string;
    return { themeId, deviceId, code };
  }

  async function admin(): Promise<Socket> {
    const socket = connectAdmin(url, token);
    sockets.push(socket);
    await waitForEvent(socket, 'connect');
    return socket;
  }

  /** A device with a (faked) helper website loaded, attached to a session. */
  async function helperDevice(code: string): Promise<Socket> {
    const socket = connectDevice(url, code, { clientVersion: '0.5.0' });
    sockets.push(socket);
    await waitForEvent(socket, 'welcome');
    socket.emit('helper:info', { version: '0.8.0' });
    return socket;
  }

  async function productionSession(themeId: string): Promise<string> {
    const session = await post('/api/sessions', {
      themeId,
      mode: 'production',
    });
    sessionIds.push(session.id as string);
    return session.id as string;
  }

  function ack<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
    return socket.timeout(3000).emitWithAck(event, payload) as Promise<T>;
  }

  it('operator starts a call: device gets connecting, admins see it, device reports connected', async () => {
    const { themeId, deviceId, code } = await fixture();
    const sessionId = await productionSession(themeId);
    const device = await helperDevice(code);
    const a = await admin();
    const states: AdminCallState[] = [];
    a.on('call:state', (s: AdminCallState) => states.push(s));

    const deviceState = waitForEvent<DeviceCallState>(device, 'call:state');
    const result = await ack<CallActionAck>(a, 'call:start', {
      sessionId,
      deviceId,
      peerId: 'admin-peer',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.call).toMatchObject({
      sessionId,
      deviceId,
      status: 'connecting',
      adminSocketId: a.id,
      adminPeerId: 'admin-peer',
    });
    const connecting = await deviceState;
    expect(connecting).toMatchObject({
      status: 'connecting',
      callId: result.call.callId,
      adminPeerId: 'admin-peer',
      devicePeerId: result.call.devicePeerId,
    });
    await waitUntil(() => states.some((s) => s.call?.status === 'connecting'));

    device.emit('call:status', {
      callId: result.call.callId,
      status: 'connected',
    });
    await waitUntil(() => states.some((s) => s.call?.status === 'connected'));
    expect(states.at(-1)!.call!.connectedAt).toEqual(expect.any(Number));

    const ended = waitForEvent<DeviceCallState>(device, 'call:state');
    const end = await ack<CallActionAck>(a, 'call:end', { sessionId });
    expect(end.ok).toBe(true);
    expect(await ended).toEqual({
      status: 'ended',
      callId: result.call.callId,
      reason: 'admin_ended',
    });
    await waitUntil(() =>
      states.some((s) => s.call === null && s.endReason === 'admin_ended'),
    );

    const logs = (await get(
      `/api/sessions/${sessionId}/logs`,
    )) as SessionLogEntry[];
    const callLogs = logs.filter((l) => l.kind === 'call');
    expect(callLogs.map((l) => l.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Call started by operator'),
        expect.stringContaining('connected'),
        expect.stringContaining('ended'),
      ]),
    );
  });

  it('device requests: busy for a second request, accept by one admin, other admins are busy/not owner', async () => {
    const { themeId, deviceId, code } = await fixture();
    const sessionId = await productionSession(themeId);
    const device = await helperDevice(code);
    const a = await admin();
    const b = await admin();
    const bStates: AdminCallState[] = [];
    b.on('call:state', (s: AdminCallState) => bStates.push(s));

    const requested = await ack<CallRequestAck>(device, 'call:request', {});
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error('unreachable');
    await waitUntil(() => bStates.some((s) => s.call?.status === 'requested'));
    expect(bStates.at(-1)!.call).toMatchObject({
      callId: requested.callId,
      deviceId,
      adminSocketId: null,
      requestedAt: expect.any(Number),
    });

    const again = await ack<CallRequestAck>(device, 'call:request', {});
    expect(again).toEqual({ ok: false, reason: 'busy' });
    const startWhileRequested = await ack<CallActionAck>(a, 'call:start', {
      sessionId,
      deviceId,
      peerId: 'a-peer',
    });
    expect(startWhileRequested).toEqual({ ok: false, reason: 'busy' });

    const deviceState = waitForEvent<DeviceCallState>(device, 'call:state');
    const accepted = await ack<CallActionAck>(a, 'call:accept', {
      sessionId,
      callId: requested.callId,
      peerId: 'a-peer',
    });
    expect(accepted.ok).toBe(true);
    expect((await deviceState).status).toBe('connecting');
    await waitUntil(() => bStates.some((s) => s.call?.status === 'connecting'));
    expect(bStates.at(-1)!.call!.adminSocketId).toBe(a.id);

    expect(
      await ack<CallActionAck>(b, 'call:accept', {
        sessionId,
        callId: requested.callId,
        peerId: 'b-peer',
      }),
    ).toEqual({ ok: false, reason: 'busy' });
    expect(
      await ack<CallActionAck>(b, 'call:decline', {
        sessionId,
        callId: requested.callId,
      }),
    ).toEqual({ ok: false, reason: 'busy' });
    expect(await ack<CallActionAck>(b, 'call:end', { sessionId })).toEqual({
      ok: false,
      reason: 'not_owner',
    });

    // A late admin gets the live call in its connect dump.
    const c = await admin();
    const dump = await waitForEvent<AdminCallState>(c, 'call:state');
    expect(dump.call?.callId).toBe(requested.callId);

    expect((await ack<CallActionAck>(a, 'call:end', { sessionId })).ok).toBe(
      true,
    );
    await waitUntil(() => bStates.some((s) => s.call === null));
    expect(await ack<CallActionAck>(a, 'call:end', { sessionId })).toEqual({
      ok: false,
      reason: 'no_call',
    });
  });

  it('decline and cancel clear a pending request', async () => {
    const { themeId, code } = await fixture();
    const sessionId = await productionSession(themeId);
    const device = await helperDevice(code);
    const a = await admin();
    const states: AdminCallState[] = [];
    a.on('call:state', (s: AdminCallState) => states.push(s));

    const first = await ack<CallRequestAck>(device, 'call:request', {});
    if (!first.ok) throw new Error('request refused');
    const declined = waitForEvent<DeviceCallState>(device, 'call:state');
    expect(
      (
        await ack<CallActionAck>(a, 'call:decline', {
          sessionId,
          callId: first.callId,
        })
      ).ok,
    ).toBe(true);
    expect(await declined).toEqual({
      status: 'ended',
      callId: first.callId,
      reason: 'declined',
    });

    const second = await ack<CallRequestAck>(device, 'call:request', {});
    if (!second.ok) throw new Error('request refused');
    const cancelled = waitForEvent<DeviceCallState>(device, 'call:state');
    device.emit('call:cancel', { callId: second.callId });
    expect(await cancelled).toEqual({
      status: 'ended',
      callId: second.callId,
      reason: 'cancelled',
    });
    await waitUntil(() =>
      states.some((s) => s.call === null && s.endReason === 'cancelled'),
    );
  });

  it('ends the call when the owning admin disconnects or the device goes offline', async () => {
    const { themeId, deviceId, code } = await fixture();
    const sessionId = await productionSession(themeId);
    const device = await helperDevice(code);
    const owner = await admin();
    const watcher = await admin();
    const states: AdminCallState[] = [];
    watcher.on('call:state', (s: AdminCallState) => states.push(s));

    const connecting = waitForEvent<DeviceCallState>(device, 'call:state');
    const started = await ack<CallActionAck>(owner, 'call:start', {
      sessionId,
      deviceId,
      peerId: 'owner-peer',
    });
    if (!started.ok) throw new Error('start refused');
    await connecting;
    const ended = waitForEvent<DeviceCallState>(device, 'call:state');
    owner.disconnect();
    expect(await ended).toEqual({
      status: 'ended',
      callId: started.call.callId,
      reason: 'admin_disconnected',
    });
    await waitUntil(() =>
      states.some((s) => s.endReason === 'admin_disconnected'),
    );

    const connectingAgain = waitForEvent<DeviceCallState>(device, 'call:state');
    const again = await ack<CallActionAck>(watcher, 'call:start', {
      sessionId,
      deviceId,
      peerId: 'watcher-peer',
    });
    expect(again.ok).toBe(true);
    await connectingAgain;
    device.disconnect();
    await waitUntil(() => states.some((s) => s.endReason === 'device_offline'));
  });

  it('refuses test sessions, devices without a helper, and outdated clients', async () => {
    const { themeId, deviceId, code } = await fixture();
    const a = await admin();

    const test = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [{ deviceId, code: nextTestCode() }],
    });
    sessionIds.push(test.id as string);
    const testCode = test.testDeviceCodes[0].code as string;
    const testDevice = await helperDevice(testCode);
    expect(await ack<CallRequestAck>(testDevice, 'call:request', {})).toEqual({
      ok: false,
      reason: 'test_session',
    });
    expect(
      await ack<CallActionAck>(a, 'call:start', {
        sessionId: test.id,
        deviceId,
        peerId: 'p',
      }),
    ).toEqual({ ok: false, reason: 'test_session' });
    await post(`/api/sessions/${test.id}/end`);

    const sessionId = await productionSession(themeId);
    const plain = connectDevice(url, code, { clientVersion: '0.5.0' });
    sockets.push(plain);
    await waitForEvent(plain, 'welcome');
    expect(
      await ack<CallActionAck>(a, 'call:start', {
        sessionId,
        deviceId,
        peerId: 'p',
      }),
    ).toEqual({ ok: false, reason: 'no_helper' });
    expect(await ack<CallRequestAck>(plain, 'call:request', {})).toEqual({
      ok: false,
      reason: 'no_helper',
    });
    plain.disconnect();
    await waitUntil(() => false, 100).catch(() => {});

    const old = connectDevice(url, code, { clientVersion: '0.4.0' });
    sockets.push(old);
    await waitForEvent(old, 'welcome');
    old.emit('helper:info', { version: '0.8.0' });
    await waitUntil(() => false, 100).catch(() => {});
    expect(
      await ack<CallActionAck>(a, 'call:start', {
        sessionId,
        deviceId,
        peerId: 'p',
      }),
    ).toEqual({ ok: false, reason: 'device_outdated' });
    old.disconnect();
    await waitUntil(() => false, 100).catch(() => {});
    expect(
      await ack<CallActionAck>(a, 'call:start', {
        sessionId,
        deviceId,
        peerId: 'p',
      }),
    ).toEqual({ ok: false, reason: 'device_offline' });
  });

  it('ends the call with the session', async () => {
    const { themeId, deviceId, code } = await fixture();
    const sessionId = await productionSession(themeId);
    const device = await helperDevice(code);
    const a = await admin();
    const states: AdminCallState[] = [];
    a.on('call:state', (s: AdminCallState) => states.push(s));
    const connecting = waitForEvent<DeviceCallState>(device, 'call:state');
    const started = await ack<CallActionAck>(a, 'call:start', {
      sessionId,
      deviceId,
      peerId: 'p',
    });
    if (!started.ok) throw new Error('start refused');
    await connecting;
    const ended = waitForEvent<DeviceCallState>(device, 'call:state');
    await post(`/api/sessions/${sessionId}/end`);
    expect(await ended).toMatchObject({
      status: 'ended',
      reason: 'session_ended',
    });
    await waitUntil(() => states.some((s) => s.endReason === 'session_ended'));
  });
});
