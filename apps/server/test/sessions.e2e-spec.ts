import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login, nextTestCode } from './helpers';

describe('Sessions (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  async function createTheme(
    timeLimitMs: number | null = null,
  ): Promise<string> {
    const res = await auth(
      request(server())
        .post('/api/themes')
        .send({ name: 'sessions e2e', timeLimitMs }),
    ).expect(201);
    return res.body.id as string;
  }

  async function createDevice(themeId: string, name: string, code: string) {
    const res = await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({
          kind: 'device',
          name,
          code,
          data: { displayName: `Device ${name}` },
        }),
    ).expect(201);
    return res.body.id as string;
  }

  it('creates an idle test session with operator-entered codes and starts it', async () => {
    const themeId = await createTheme();
    const devA = await createDevice(themeId, 'dev-a', 'code-a');
    const devB = await createDevice(themeId, 'dev-b', 'code-b');
    const codeA = nextTestCode();
    const codeB = nextTestCode();

    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [
            { deviceId: devA, code: codeA },
            { deviceId: devB, code: codeB },
          ],
        }),
    ).expect(201);
    const session = created.body;
    // created idle — no timer armed, no session:start yet
    expect(session).toMatchObject({ themeId, mode: 'test', state: 'created' });
    expect(session.testDeviceCodes).toHaveLength(2);
    expect(
      (session.testDeviceCodes as { deviceId: string; code: string }[]).find(
        (c) => c.deviceId === devA,
      )?.code,
    ).toBe(codeA);

    const started = await auth(
      request(server()).post(`/api/sessions/${session.id}/start`),
    ).expect(201);
    expect(started.body.state).toBe('running');
    // starting twice conflicts
    await auth(
      request(server()).post(`/api/sessions/${session.id}/start`),
    ).expect(409);

    // creation and start are logged
    const logs = await auth(
      request(server()).get(`/api/sessions/${session.id}/logs`),
    ).expect(200);
    const messages = logs.body.map((l: { message: string }) => l.message);
    expect(messages).toContain('Session created');
    expect(messages).toContain('Session started');

    // afterId cursor skips everything already seen
    const lastId = logs.body[logs.body.length - 1].id as number;
    const empty = await auth(
      request(server()).get(
        `/api/sessions/${session.id}/logs?afterId=${lastId}`,
      ),
    ).expect(200);
    expect(empty.body).toHaveLength(0);

    await auth(
      request(server()).post(`/api/sessions/${session.id}/end`),
    ).expect(201);
  });

  it('validates operator-entered device codes', async () => {
    const themeId = await createTheme();
    const devA = await createDevice(themeId, 'val-a', 'val-code-a');
    const shared = nextTestCode();

    // deviceCodes is required for test mode
    await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(400);
    // unknown device
    await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [
            {
              deviceId: '00000000-0000-4000-8000-000000000000',
              code: nextTestCode(),
            },
          ],
        }),
    ).expect(400);
    // duplicate codes in one request
    await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [
            { deviceId: devA, code: shared },
            { deviceId: devA, code: shared },
          ],
        }),
    ).expect(400);

    // a live session holds its code; reuse conflicts until the session ends
    const first = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [{ deviceId: devA, code: shared }],
        }),
    ).expect(201);
    await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [{ deviceId: devA, code: shared }],
        }),
    ).expect(409);
    await auth(
      request(server()).post(`/api/sessions/${first.body.id}/end`),
    ).expect(201);
    const reused = await auth(
      request(server())
        .post('/api/sessions')
        .send({
          themeId,
          mode: 'test',
          deviceCodes: [{ deviceId: devA, code: shared }],
        }),
    ).expect(201);
    await auth(
      request(server()).post(`/api/sessions/${reused.body.id}/end`),
    ).expect(201);
  });

  it('allows multiple concurrent test sessions but one production session', async () => {
    const themeId = await createTheme();

    const t1 = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const t2 = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);

    const p1 = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'production' }),
    ).expect(201);
    await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'production' }),
    ).expect(409);

    // ending frees the production slot
    await auth(
      request(server()).post(`/api/sessions/${p1.body.id}/end`),
    ).expect(201);
    const p2 = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'production' }),
    ).expect(201);

    for (const id of [t1.body.id, t2.body.id, p2.body.id]) {
      await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
    }
  });

  it('runs the start/pause/resume/end lifecycle with state guards', async () => {
    const themeId = await createTheme();
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const id = created.body.id as string;

    // created sessions cannot pause or resume; they must be started
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(409);
    await auth(request(server()).post(`/api/sessions/${id}/resume`)).expect(
      409,
    );
    await auth(request(server()).post(`/api/sessions/${id}/start`)).expect(201);

    await auth(request(server()).post(`/api/sessions/${id}/resume`)).expect(
      409,
    );

    const paused = await auth(
      request(server()).post(`/api/sessions/${id}/pause`),
    ).expect(201);
    expect(paused.body.state).toBe('paused');
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(409);

    const resumed = await auth(
      request(server()).post(`/api/sessions/${id}/resume`),
    ).expect(201);
    expect(resumed.body.state).toBe('running');

    const ended = await auth(
      request(server()).post(`/api/sessions/${id}/end`),
    ).expect(201);
    expect(ended.body.state).toBe('ended');
    expect(ended.body.endedAt).not.toBeNull();

    // ended sessions are no longer live
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(404);
    // ending again is idempotent
    await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
  });

  it('deletes created and ended sessions but never live ones', async () => {
    const themeId = await createTheme();

    // a never-started session can be deleted directly
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const createdId = created.body.id as string;
    await auth(request(server()).delete(`/api/sessions/${createdId}`)).expect(
      204,
    );
    await auth(request(server()).get(`/api/sessions/${createdId}`)).expect(404);

    // a live session must be ended first
    const second = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const id = second.body.id as string;
    await auth(request(server()).post(`/api/sessions/${id}/start`)).expect(201);
    await auth(request(server()).delete(`/api/sessions/${id}`)).expect(409);
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(201);
    await auth(request(server()).delete(`/api/sessions/${id}`)).expect(409);
    await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
    await auth(request(server()).delete(`/api/sessions/${id}`)).expect(204);

    // the session is gone along with its logs; a second delete 404s
    await auth(request(server()).get(`/api/sessions/${id}`)).expect(404);
    await auth(request(server()).get(`/api/sessions/${id}/logs`)).expect(404);
    await auth(request(server()).delete(`/api/sessions/${id}`)).expect(404);
  });

  it('tracks the countdown timer through pause/adjust', async () => {
    const themeId = await createTheme(10 * 60 * 1000); // 10 min
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const id = created.body.id as string;
    // idle sessions have no armed timer; starting arms it
    expect(created.body.timerEndsAt).toBeNull();
    await auth(
      request(server())
        .post(`/api/sessions/${id}/timer`)
        .send({ deltaMs: 1000 }),
    ).expect(400);
    const started = await auth(
      request(server()).post(`/api/sessions/${id}/start`),
    ).expect(201);
    expect(started.body.timerEndsAt).not.toBeNull();

    // session pause freezes the timer
    const paused = await auth(
      request(server()).post(`/api/sessions/${id}/pause`),
    ).expect(201);
    expect(paused.body.timerEndsAt).toBeNull();
    const frozen = paused.body.timerRemainingMs as number;
    expect(frozen).toBeGreaterThan(9 * 60 * 1000);

    // +1 minute while paused
    const adjusted = await auth(
      request(server())
        .post(`/api/sessions/${id}/timer`)
        .send({ deltaMs: 60_000 }),
    ).expect(201);
    expect(adjusted.body.timerRemainingMs).toBe(frozen + 60_000);

    // resume re-arms
    const resumed = await auth(
      request(server()).post(`/api/sessions/${id}/resume`),
    ).expect(201);
    expect(resumed.body.timerEndsAt).not.toBeNull();
    expect(resumed.body.timerRemainingMs).toBeNull();

    // independent timer pause while the session keeps running
    const timerPaused = await auth(
      request(server())
        .post(`/api/sessions/${id}/timer`)
        .send({ action: 'pause' }),
    ).expect(201);
    expect(timerPaused.body.state).toBe('running');
    expect(timerPaused.body.timerEndsAt).toBeNull();
    expect(timerPaused.body.timerRemainingMs).toBeGreaterThan(0);

    const timerResumed = await auth(
      request(server())
        .post(`/api/sessions/${id}/timer`)
        .send({ action: 'resume' }),
    ).expect(201);
    expect(timerResumed.body.timerEndsAt).not.toBeNull();

    await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
  });

  it('rejects timer adjustment when the theme has no timer', async () => {
    const themeId = await createTheme(null);
    const created = await auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    await auth(
      request(server())
        .post(`/api/sessions/${created.body.id}/timer`)
        .send({ deltaMs: 1000 }),
    ).expect(400);
    await auth(
      request(server()).post(`/api/sessions/${created.body.id}/end`),
    ).expect(201);
  });

  it('404s session creation on a missing theme', () =>
    auth(
      request(server()).post('/api/sessions').send({
        themeId: '00000000-0000-0000-0000-000000000000',
        mode: 'test',
        deviceCodes: [],
      }),
    ).expect(404));
});
