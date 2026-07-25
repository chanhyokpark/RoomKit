import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login } from './helpers';

describe('Media (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let themeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  async function uploadFile(
    filename: string,
    contentType: string,
    content: string,
  ): Promise<string> {
    const presign = await auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/uploads`)
        .send({ filename, contentType }),
    ).expect(201);
    const putRes = await fetch(presign.body.url as string, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: content,
    });
    expect(putRes.status).toBe(200);
    return presign.body.key as string;
  }

  async function createAsset(
    kind: string,
    data: unknown,
    name = `${kind} asset`,
  ): Promise<string> {
    const res = await auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/assets`)
        .send({ kind, name, data }),
    ).expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    const theme = await auth(
      request(app.getHttpServer())
        .post('/api/themes')
        .send({ name: 'media e2e' }),
    ).expect(201);
    themeId = theme.body.id as string;
  });

  afterAll(async () => {
    await auth(
      request(app.getHttpServer()).delete(`/api/themes/${themeId}`),
    ).expect(204);
    await app.close();
  });

  it('creates image and file assets', async () => {
    const imageId = await createAsset('image', { fileKey: null });
    const res = await auth(
      request(app.getHttpServer()).get(
        `/api/themes/${themeId}/assets/${imageId}`,
      ),
    ).expect(200);
    expect(res.body.kind).toBe('image');
    expect(res.body.data).toEqual({ fileKey: null, placeholderRatio: '16:9' });
    await createAsset('file', { fileKey: null });
  });

  it('rejects a malformed placeholder ratio', () =>
    auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/assets`)
        .send({
          kind: 'image',
          name: 'bad ratio',
          data: { fileKey: null, placeholderRatio: '0:9' },
        }),
    ).expect(400));

  it('serves an image asset publicly at /api/media/:assetId', async () => {
    const content = `png bytes ${Date.now()}`;
    const fileKey = await uploadFile('logo.png', 'image/png', content);
    const assetId = await createAsset('image', { fileKey });

    // No Authorization header — the route must be public for webview use.
    const res = await request(app.getHttpServer())
      .get(`/api/media/${assetId}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect((res.body as Buffer).toString()).toBe(content);
  });

  it('serves file and video assets too', async () => {
    const fileContent = 'plain data';
    const fileKey = await uploadFile(
      'data.bin',
      'application/octet-stream',
      fileContent,
    );
    const fileAssetId = await createAsset('file', { fileKey });
    const fileRes = await request(app.getHttpServer())
      .get(`/api/media/${fileAssetId}`)
      .expect(200);
    expect(fileRes.body.toString()).toBe(fileContent);

    const videoContent = 'mp4 bytes';
    const videoKey = await uploadFile('clip.mp4', 'video/mp4', videoContent);
    const videoAssetId = await createAsset('video', {
      fileKey: videoKey,
      durationMs: 1000,
    });
    const videoRes = await request(app.getHttpServer())
      .get(`/api/media/${videoAssetId}`)
      .expect(200);
    expect(videoRes.headers['content-type']).toContain('video/mp4');
    expect(videoRes.body.toString()).toBe(videoContent);
  });

  it('serves an SVG placeholder for a fileless image', async () => {
    const assetId = await createAsset('image', {
      fileKey: null,
      placeholderRatio: '4:3',
    });
    const res = await request(app.getHttpServer())
      .get(`/api/media/${assetId}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    const svg = (res.body as Buffer).toString();
    expect(svg).toContain('width="800" height="600"');
    expect(svg).toContain('4:3');
  });

  it('defaults the placeholder ratio to 16:9', async () => {
    const assetId = await createAsset('image', { fileKey: null });
    const res = await request(app.getHttpServer())
      .get(`/api/media/${assetId}`)
      .expect(200);
    expect((res.body as Buffer).toString()).toContain(
      'width="800" height="450"',
    );
  });

  it('404s for a fileless file asset', async () => {
    const assetId = await createAsset('file', { fileKey: null });
    await request(app.getHttpServer()).get(`/api/media/${assetId}`).expect(404);
  });

  it('404s for a non-file-backed kind', async () => {
    const assetId = await createAsset('phase', { order: 1 });
    await request(app.getHttpServer()).get(`/api/media/${assetId}`).expect(404);
  });

  it('404s for an unknown asset id', () =>
    request(app.getHttpServer())
      .get('/api/media/00000000-0000-0000-0000-000000000000')
      .expect(404));
});
