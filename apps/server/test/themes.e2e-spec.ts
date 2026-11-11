import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionRuntimeService } from '../src/runtime/session-runtime.service';
import { createTestApp, login } from './helpers';

describe('Themes (e2e)', () => {
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

  it('runs through the CRUD lifecycle', async () => {
    const created = await auth(
      request(app.getHttpServer())
        .post('/api/themes')
        .send({ name: 'e2e theme', timeLimitMs: 3_600_000 }),
    ).expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      name: 'e2e theme',
      timeLimitMs: 3_600_000,
    });

    const fetched = await auth(
      request(app.getHttpServer()).get(`/api/themes/${id}`),
    ).expect(200);
    expect(fetched.body.id).toBe(id);

    const list = await auth(
      request(app.getHttpServer()).get('/api/themes'),
    ).expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toContain(id);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/themes/${id}`)
        .send({ name: 'renamed', timeLimitMs: null }),
    ).expect(200);
    expect(updated.body).toMatchObject({ name: 'renamed', timeLimitMs: null });

    await auth(request(app.getHttpServer()).delete(`/api/themes/${id}`)).expect(
      204,
    );
    await auth(request(app.getHttpServer()).get(`/api/themes/${id}`)).expect(
      404,
    );
  });

  it('ends live sessions before deleting their theme', async () => {
    const theme = await auth(
      request(app.getHttpServer()).post('/api/themes').send({ name: 'live' }),
    ).expect(201);
    const session = await auth(
      request(app.getHttpServer())
        .post('/api/sessions')
        .send({ themeId: theme.body.id, mode: 'test', deviceCodes: [] }),
    ).expect(201);
    const sessionId = session.body.id as string;
    await auth(
      request(app.getHttpServer()).post(`/api/sessions/${sessionId}/start`),
    ).expect(201);
    const runtime = app.get(SessionRuntimeService);
    expect(runtime.isLive(sessionId)).toBe(true);

    await auth(
      request(app.getHttpServer()).delete(`/api/themes/${theme.body.id}`),
    ).expect(204);
    expect(runtime.isLive(sessionId)).toBe(false);
  });

  it('rejects an invalid create body', () =>
    auth(
      request(app.getHttpServer()).post('/api/themes').send({ name: '' }),
    ).expect(400));

  it('rejects a non-integer time limit', () =>
    auth(
      request(app.getHttpServer())
        .post('/api/themes')
        .send({ name: 'x', timeLimitMs: -5 }),
    ).expect(400));

  it('404s on a missing theme', () =>
    auth(
      request(app.getHttpServer()).get(
        '/api/themes/00000000-0000-0000-0000-000000000000',
      ),
    ).expect(404));
});
