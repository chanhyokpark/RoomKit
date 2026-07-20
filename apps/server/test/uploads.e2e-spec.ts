import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login } from './helpers';

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let themeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    const theme = await auth(
      request(app.getHttpServer())
        .post('/api/themes')
        .send({ name: 'uploads e2e' }),
    ).expect(201);
    themeId = theme.body.id as string;
  });

  afterAll(async () => {
    await auth(
      request(app.getHttpServer()).delete(`/api/themes/${themeId}`),
    ).expect(204);
    await app.close();
  });

  it('404s presign for a missing theme', () =>
    auth(
      request(app.getHttpServer())
        .post('/api/themes/00000000-0000-0000-0000-000000000000/uploads')
        .send({ filename: 'a.mp3', contentType: 'audio/mpeg' }),
    ).expect(404));

  it('rejects a presign request without contentType', () =>
    auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/uploads`)
        .send({ filename: 'a.mp3' }),
    ).expect(400));

  it('presigns, uploads to MinIO, and reads the file back', async () => {
    const presign = await auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/uploads`)
        .send({ filename: 'héllo file.mp3', contentType: 'audio/mpeg' }),
    ).expect(201);

    const { key, url, expiresIn } = presign.body as {
      key: string;
      url: string;
      expiresIn: number;
    };
    expect(key).toMatch(
      new RegExp(`^themes/${themeId}/[0-9a-f-]{36}/h_llo_file\\.mp3$`),
    );
    expect(expiresIn).toBe(600);

    const content = `roomkit e2e ${Date.now()}`;
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: content,
    });
    expect(putRes.status).toBe(200);

    const fileUrl = await auth(
      request(app.getHttpServer()).get(
        `/api/files/url?key=${encodeURIComponent(key)}`,
      ),
    ).expect(200);

    const getRes = await fetch(fileUrl.body.url as string);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe(content);
  });

  it('rejects /files/url without a key', () =>
    auth(request(app.getHttpServer()).get('/api/files/url')).expect(400));
});
