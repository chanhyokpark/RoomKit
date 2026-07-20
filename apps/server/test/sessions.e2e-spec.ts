import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login } from './helpers';

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

  async function createTheme(timeLimitMs: number | null = null): Promise<string> {
    const res = await auth(
      request(server()).post('/api/themes').send({ name: 'sessions e2e', timeLimitMs }),
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

  it('creates a test session with one code per device and lists logs', async () => {
    const themeId = await createTheme();
    await createDevice(themeId, 'dev-a', 'code-a');
    await createDevice(themeId, 'dev-b', 'code-b');

    const created = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);
    const session = created.body;
    expect(session).toMatchObject({ themeId, mode: 'test', state: 'running' });
    expect(session.testDeviceCodes).toHaveLength(2);
    for (const c of session.testDeviceCodes) {
      expect(c.code).toMatch(/^tst_[a-z2-9]{10}$/);
      expect(c.displayName).toMatch(/^Device /);
    }

    // session:start is logged
    const logs = await auth(
      request(server()).get(`/api/sessions/${session.id}/logs`),
    ).expect(200);
    expect(logs.body.length).toBeGreaterThan(0);
    expect(logs.body[0]).toMatchObject({ kind: 'session', level: 'info' });

    // afterId cursor skips everything already seen
    const lastId = logs.body[logs.body.length - 1].id as number;
    const empty = await auth(
      request(server()).get(`/api/sessions/${session.id}/logs?afterId=${lastId}`),
    ).expect(200);
    expect(empty.body).toHaveLength(0);

    await auth(request(server()).post(`/api/sessions/${session.id}/end`)).expect(201);
  });

  it('allows multiple concurrent test sessions but one production session', async () => {
    const themeId = await createTheme();

    const t1 = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);
    const t2 = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);

    const p1 = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'production' }),
    ).expect(201);
    await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'production' }),
    ).expect(409);

    // ending frees the production slot
    await auth(request(server()).post(`/api/sessions/${p1.body.id}/end`)).expect(201);
    const p2 = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'production' }),
    ).expect(201);

    for (const id of [t1.body.id, t2.body.id, p2.body.id]) {
      await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
    }
  });

  it('runs the pause/resume/end lifecycle with state guards', async () => {
    const themeId = await createTheme();
    const created = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);
    const id = created.body.id as string;

    await auth(request(server()).post(`/api/sessions/${id}/resume`)).expect(409);

    const paused = await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(201);
    expect(paused.body.state).toBe('paused');
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(409);

    const resumed = await auth(request(server()).post(`/api/sessions/${id}/resume`)).expect(201);
    expect(resumed.body.state).toBe('running');

    const ended = await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
    expect(ended.body.state).toBe('ended');
    expect(ended.body.endedAt).not.toBeNull();

    // ended sessions are no longer live
    await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(404);
    // ending again is idempotent
    await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
  });

  it('tracks the countdown timer through pause/adjust', async () => {
    const themeId = await createTheme(10 * 60 * 1000); // 10 min
    const created = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);
    const id = created.body.id as string;
    expect(created.body.timerEndsAt).not.toBeNull();

    // session pause freezes the timer
    const paused = await auth(request(server()).post(`/api/sessions/${id}/pause`)).expect(201);
    expect(paused.body.timerEndsAt).toBeNull();
    const frozen = paused.body.timerRemainingMs as number;
    expect(frozen).toBeGreaterThan(9 * 60 * 1000);

    // +1 minute while paused
    const adjusted = await auth(
      request(server()).post(`/api/sessions/${id}/timer`).send({ deltaMs: 60_000 }),
    ).expect(201);
    expect(adjusted.body.timerRemainingMs).toBe(frozen + 60_000);

    // resume re-arms
    const resumed = await auth(request(server()).post(`/api/sessions/${id}/resume`)).expect(201);
    expect(resumed.body.timerEndsAt).not.toBeNull();
    expect(resumed.body.timerRemainingMs).toBeNull();

    // independent timer pause while the session keeps running
    const timerPaused = await auth(
      request(server()).post(`/api/sessions/${id}/timer`).send({ action: 'pause' }),
    ).expect(201);
    expect(timerPaused.body.state).toBe('running');
    expect(timerPaused.body.timerEndsAt).toBeNull();
    expect(timerPaused.body.timerRemainingMs).toBeGreaterThan(0);

    const timerResumed = await auth(
      request(server()).post(`/api/sessions/${id}/timer`).send({ action: 'resume' }),
    ).expect(201);
    expect(timerResumed.body.timerEndsAt).not.toBeNull();

    await auth(request(server()).post(`/api/sessions/${id}/end`)).expect(201);
  });

  it('rejects timer adjustment when the theme has no timer', async () => {
    const themeId = await createTheme(null);
    const created = await auth(
      request(server()).post('/api/sessions').send({ themeId, mode: 'test' }),
    ).expect(201);
    await auth(
      request(server())
        .post(`/api/sessions/${created.body.id}/timer`)
        .send({ deltaMs: 1000 }),
    ).expect(400);
    await auth(request(server()).post(`/api/sessions/${created.body.id}/end`)).expect(201);
  });

  it('404s session creation on a missing theme', () =>
    auth(
      request(server())
        .post('/api/sessions')
        .send({ themeId: '00000000-0000-0000-0000-000000000000', mode: 'test' }),
    ).expect(404));
});
