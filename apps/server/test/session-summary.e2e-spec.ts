import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { HintShow, SessionSummary } from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectDevice,
  createSocketTestApp,
  login,
  nextTestCode,
  waitForEvent,
} from './helpers';

const HINT_CODE = '0417';
const TIME_LIMIT_MS = 600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Session summary (e2e)', () => {
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
    return (await post(`/api/themes/${themeId}/assets`, input)).id as string;
  }

  async function getSummary(sessionId: string): Promise<SessionSummary> {
    const res = await auth(
      request(server()).get(`/api/sessions/${sessionId}/summary`),
    ).expect(200);
    return res.body as SessionSummary;
  }

  async function waitForEnded(sessionId: string) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const res = await auth(
        request(server()).get(`/api/sessions/${sessionId}/summary`),
      );
      if (res.status === 200) return;
      if (Date.now() > deadline) {
        throw new Error(`summary still ${res.status} after end`);
      }
      await sleep(50);
    }
  }

  /** Theme with a timer, two phases, a hint device + hint, and an endTheme event. */
  async function fixture() {
    const themeId = (
      await post('/api/themes', {
        name: 'summary e2e',
        timeLimitMs: TIME_LIMIT_MS,
      })
    ).id as string;
    const phase1 = await createAsset(themeId, {
      kind: 'phase',
      name: 'phase-one',
      data: { order: 0 },
    });
    const phase2 = await createAsset(themeId, {
      kind: 'phase',
      name: 'phase-two',
      data: { order: 1 },
    });
    const hintDeviceId = await createAsset(themeId, {
      kind: 'device',
      name: 'hint-device',
      code: `hint-${randomUUID().slice(0, 8)}`,
      data: { displayName: '힌트 장치', isHintDevice: true },
    });
    const hintId = await createAsset(themeId, {
      kind: 'hint',
      name: 'first-puzzle',
      code: HINT_CODE,
      data: {
        steps: [
          { textHtml: '<p>one</p>', imageKey: null },
          { textHtml: '<p>two</p>', imageKey: null },
        ],
      },
    });
    const successEventId = await createAsset(themeId, {
      kind: 'event',
      name: 'finish',
      data: {
        phaseId: null,
        triggerKind: 'manual',
        triggerName: null,
        manualTriggerable: true,
        allowReentry: false,
        sequence: [{ id: randomUUID(), type: 'endTheme', verdict: 'success' }],
      },
    });
    return { themeId, phase1, phase2, hintDeviceId, hintId, successEventId };
  }

  async function createSession(
    themeId: string,
    deviceCodes: { deviceId: string; code: string }[] = [],
  ) {
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes,
    });
    sessionIds.push(session.id as string);
    return session as {
      id: string;
      testDeviceCodes: { deviceId: string; code: string }[];
    };
  }

  it('reconstructs phase times, pauses, timer, and hint usage after endTheme', async () => {
    const { themeId, phase1, phase2, hintDeviceId, hintId, successEventId } =
      await fixture();
    const session = await createSession(themeId, [
      { deviceId: hintDeviceId, code: nextTestCode() },
    ]);
    const sessionId = session.id;
    await post(`/api/sessions/${sessionId}/start`);

    // Not ended yet → 409.
    await auth(
      request(server()).get(`/api/sessions/${sessionId}/summary`),
    ).expect(409);

    // Player enters the hint code (kind='hint' "shown" log).
    const socket = connectDevice(
      url,
      session.testDeviceCodes.find((c) => c.deviceId === hintDeviceId)!.code,
    );
    sockets.push(socket);
    await waitForEvent(socket, 'welcome');
    const showPromise = waitForEvent<HintShow>(socket, 'hint:show');
    socket.emit('hint:submit', { code: HINT_CODE });
    await showPromise;

    // Admin pushes step 1 of the same hint.
    await post(`/api/sessions/${sessionId}/hint`, { hintId, step: 1 });

    await sleep(60); // time spent in phase 1
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: phase2 });
    await post(`/api/sessions/${sessionId}/phase/restart`);

    await post(`/api/sessions/${sessionId}/pause`);
    await sleep(120);
    await post(`/api/sessions/${sessionId}/resume`);

    await post(`/api/sessions/${sessionId}/timer`, { deltaMs: 60_000 });

    await post(`/api/sessions/${sessionId}/trigger`, {
      eventId: successEventId,
    });
    await waitForEnded(sessionId);

    const summary = await getSummary(sessionId);
    expect(summary.sessionId).toBe(sessionId);
    expect(summary.verdict).toBe('success');
    expect(summary.startedAt).not.toBeNull();
    expect(summary.endedAt).not.toBeNull();

    expect(summary.pauseCount).toBe(1);
    expect(summary.totalPausedMs).toBeGreaterThan(0);
    expect(summary.totalActiveMs).toBe(
      summary.totalWallMs - summary.totalPausedMs,
    );

    // Segments partition [started, ended] exactly.
    const phaseIds = summary.phases.map((p) => p.phaseId).sort();
    expect(phaseIds).toEqual([phase1, phase2].sort());
    const wallSum = summary.phases.reduce((sum, p) => sum + p.wallMs, 0);
    expect(wallSum).toBe(summary.totalWallMs);
    for (const p of summary.phases) {
      expect(p.entries).toBe(1);
      expect(p.activeMs).toBeLessThanOrEqual(p.wallMs);
    }
    expect(summary.phaseRestartCount).toBe(1);

    expect(summary.timer).toMatchObject({
      timeLimitMs: TIME_LIMIT_MS,
      expired: false,
      adjustmentCount: 1,
    });
    expect(summary.timer!.remainingMsAtEnd).toBeGreaterThan(0);
    expect(summary.timer!.remainingMsAtEnd).toBeLessThanOrEqual(
      TIME_LIMIT_MS + 60_000,
    );

    expect(summary.hints).toHaveLength(1);
    expect(summary.hints[0]).toMatchObject({
      hintId,
      code: HINT_CODE,
      shows: 1,
      adminPushes: 1,
      maxStep: 1,
    });
  });

  it('handles a force-ended session (no endTheme): verdict null, timer from row', async () => {
    const { themeId } = await fixture();
    const session = await createSession(themeId);
    await post(`/api/sessions/${session.id}/start`);
    await post(`/api/sessions/${session.id}/end`);
    await waitForEnded(session.id);

    const summary = await getSummary(session.id);
    expect(summary.verdict).toBeNull();
    expect(summary.startedAt).not.toBeNull();
    expect(summary.timer).toMatchObject({ expired: false });
    // Timer was running at force-end → remaining derived from timerEndsAt.
    expect(summary.timer!.remainingMsAtEnd).toBeGreaterThan(0);
    expect(summary.hints).toEqual([]);
    expect(summary.pauseCount).toBe(0);
  });

  it('handles a session ended without ever starting', async () => {
    const { themeId } = await fixture();
    const session = await createSession(themeId);
    await post(`/api/sessions/${session.id}/end`);
    await waitForEnded(session.id);

    const summary = await getSummary(session.id);
    expect(summary.startedAt).toBeNull();
    expect(summary.totalWallMs).toBe(0);
    expect(summary.phases).toEqual([]);
    // Timer never armed → remaining is the full limit.
    expect(summary.timer!.remainingMsAtEnd).toBe(TIME_LIMIT_MS);
  });
});
