import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PlayerWebsiteTestStart,
  PlayerWebsiteTestStop,
  SessionState,
  WebsiteTestActivity,
  WebsiteTestRun,
  Welcome,
  WireCommand,
} from '@roomkit/shared';
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

describe('Website test (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let token: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ({ app, url } = await createSocketTestApp());
    token = await login(app);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
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
    return auth(
      request(server())
        .post(path)
        .send(body ?? {}),
    );
  }

  /** Theme with two devices and one device-triggered event. */
  async function fixture() {
    const theme = await post('/api/themes', {
      name: 'website test e2e',
      timeLimitMs: 60 * 60_000,
    });
    const themeId = theme.body.id as string;
    const deviceIds: string[] = [];
    for (const name of ['stage', 'other']) {
      const res = await post(`/api/themes/${themeId}/assets`, {
        kind: 'device',
        name,
        code: `prod-${randomUUID().slice(0, 8)}`,
        data: { displayName: name },
      });
      deviceIds.push(res.body.id as string);
    }
    const [stageId, otherId] = deviceIds;
    const event = await post(`/api/themes/${themeId}/assets`, {
      kind: 'event',
      name: 'door-open handler',
      data: {
        phaseId: null,
        triggerKind: 'device',
        triggerName: 'door-open',
        manualTriggerable: true,
        allowReentry: false,
        sequence: [
          { id: randomUUID(), type: 'resetDevice', deviceId: otherId },
          { id: randomUUID(), type: 'resetDevice', deviceId: stageId },
        ],
      },
    });
    return { themeId, stageId, otherId, eventId: event.body.id as string };
  }

  async function startRun(themeId: string, deviceId: string) {
    const playerId = randomUUID();
    const player = track(connectPlayer(url, playerId, '웹테스트 플레이어'));
    await waitForEvent(player, 'connect');
    const started = waitForEvent<PlayerWebsiteTestStart>(
      player,
      'websiteTest:start',
    );
    const res = await post('/api/website-test', {
      themeId,
      playerId,
      deviceId,
      url: 'http://localhost:5173/',
    });
    expect(res.status).toBe(201);
    const run = res.body as WebsiteTestRun;
    expect((await started).device.code).toBe(run.code);
    return { run, player };
  }

  /** Attach a device socket to a run and consume welcome + initial navigate. */
  async function attachDevice(code: string) {
    const device = track(connectDevice(url, code));
    // Register both waiters up front — the navigate lands right after welcome.
    const welcome = waitForEvent<Welcome>(device, 'welcome');
    const navigate = waitForEvent<WireCommand>(device, 'command');
    return { device, welcome: await welcome, navigate: await navigate };
  }

  it('launches, navigates, and never persists a session', async () => {
    const { themeId, stageId } = await fixture();
    const { run } = await startRun(themeId, stageId);
    expect(run.timerState).toBe('running');

    const { welcome, navigate } = await attachDevice(run.code);
    expect(welcome.session.mode).toBe('test');
    expect(welcome.session.state).toBe('running');
    expect(welcome.session.sessionId).toBe(run.runId);
    expect(navigate).toMatchObject({
      type: 'navigate',
      url: 'http://localhost:5173/',
      force: false,
    });

    // Nothing was saved: no session rows exist for the theme.
    const sessions = await auth(
      request(server()).get(`/api/sessions?themeId=${themeId}`),
    );
    expect(sessions.body).toEqual([]);
  });

  it('reports website triggers without executing the matched event', async () => {
    const { themeId, stageId } = await fixture();
    const { run } = await startRun(themeId, stageId);
    const { device } = await attachDevice(run.code);

    const admin = track(connectAdmin(url, token));
    await waitForEvent(admin, 'connect');

    const activity = waitForEvent<WebsiteTestActivity>(
      admin,
      'websiteTest:activity',
    );
    let executed = false;
    device.on('command', () => (executed = true));
    device.emit('trigger', { event: 'door-open', payload: { via: 'e2e' } });

    const entry = await activity;
    expect(entry).toMatchObject({ kind: 'trigger', event: 'door-open' });
    if (entry.kind !== 'trigger') throw new Error('unreachable');
    expect(entry.matches).toHaveLength(1);
    expect(entry.matches[0].eventName).toBe('door-open handler');
    // Give any (wrong) execution a beat to arrive, then assert silence.
    await new Promise((r) => setTimeout(r, 300));
    expect(executed).toBe(false);
  });

  it('forces manual commands onto the test device and blocks flow commands', async () => {
    const { themeId, stageId, otherId } = await fixture();
    const { run } = await startRun(themeId, stageId);
    const { device } = await attachDevice(run.code);

    // Targeting the *other* device still lands on the test device.
    const wire = waitForEvent<WireCommand>(device, 'command');
    const ok = await post(`/api/website-test/${run.runId}/command`, {
      command: { type: 'resetDevice', deviceId: otherId },
    });
    expect(ok.status).toBe(204);
    expect((await wire).type).toBe('reset');

    const blocked = await post(`/api/website-test/${run.runId}/command`, {
      command: { type: 'switchPhase', phaseId: null },
    });
    expect(blocked.status).toBe(400);
  });

  it('runs events, skipping deliveries to other devices', async () => {
    const { themeId, stageId, eventId } = await fixture();
    const { run } = await startRun(themeId, stageId);
    const { device } = await attachDevice(run.code);

    const admin = track(connectAdmin(url, token));
    await waitForEvent(admin, 'connect');
    const entries: WebsiteTestActivity[] = [];
    admin.on('websiteTest:activity', (e: WebsiteTestActivity) =>
      entries.push(e),
    );

    let resets = 0;
    device.on('command', (wire: WireCommand) => {
      if (wire.type === 'reset') resets++;
    });
    const res = await post(`/api/website-test/${run.runId}/run-event`, {
      eventId,
    });
    expect(res.status).toBe(204);

    // Wait for the run to finish (started → skipped/sent → finished).
    for (let i = 0; i < 30; i++) {
      if (
        entries.some((e) => e.kind === 'eventRun' && e.status === 'finished')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // The other-device reset was skipped; only the test device's ran.
    expect(resets).toBe(1);
    expect(
      entries.some((e) => e.kind === 'command' && e.status === 'skipped'),
    ).toBe(true);
  });

  it('adjusts the fake timer and pushes session:state to the device', async () => {
    const { themeId, stageId } = await fixture();
    const { run } = await startRun(themeId, stageId);
    const { device } = await attachDevice(run.code);

    const state = waitForEvent<SessionState>(device, 'session:state');
    const res = await post(`/api/website-test/${run.runId}/timer`, {
      remainingMs: 5 * 60_000,
    });
    expect(res.status).toBe(201);
    expect((res.body as WebsiteTestRun).timerRemainingMs).toBeLessThanOrEqual(
      5 * 60_000,
    );
    expect((await state).timerRemainingMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it('stops the run, freeing the code and telling the player', async () => {
    const { themeId, stageId } = await fixture();
    const { run, player } = await startRun(themeId, stageId);
    await attachDevice(run.code);

    const stopped = waitForEvent<PlayerWebsiteTestStop>(
      player,
      'websiteTest:stop',
    );
    await auth(
      request(server()).delete(`/api/website-test/${run.runId}`),
    ).expect(204);
    expect((await stopped).runId).toBe(run.runId);

    // The code is gone — a reconnect is rejected outright.
    const rejoin = track(connectDevice(url, run.code));
    expect(await waitForConnectError(rejoin)).toBe('invalid_code');

    const list = await auth(
      request(server()).get(`/api/website-test?themeId=${themeId}`),
    );
    expect(list.body).toEqual([]);
  });
});
