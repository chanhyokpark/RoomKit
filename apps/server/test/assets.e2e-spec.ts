import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login } from './helpers';

describe('Assets (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let themeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const createAsset = (body: object) =>
    auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/assets`)
        .send(body),
    );

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    const theme = await auth(
      request(app.getHttpServer())
        .post('/api/themes')
        .send({ name: 'assets e2e' }),
    ).expect(201);
    themeId = theme.body.id as string;
  });

  afterAll(async () => {
    await auth(
      request(app.getHttpServer()).delete(`/api/themes/${themeId}`),
    ).expect(204);
    await app.close();
  });

  it('creates one asset of every kind', async () => {
    const device = await createAsset({
      kind: 'device',
      name: 'button',
      code: 'btn-1',
      data: {},
    }).expect(201);
    const deviceId = device.body.id as string;
    expect(device.body).toMatchObject({
      kind: 'device',
      code: 'btn-1',
      tags: [],
    });

    const screen = await createAsset({
      kind: 'device',
      name: 'screen',
      code: 'screen-1',
      data: {},
    }).expect(201);

    await createAsset({
      kind: 'bgm',
      name: 'main bgm',
      data: { fileKey: 'themes/x/bgm.mp3' },
    }).expect(201);

    await createAsset({
      kind: 'sfx',
      name: 'ding',
      data: { fileKey: 'themes/x/ding.mp3' },
    }).expect(201);

    await createAsset({
      kind: 'video',
      name: 'intro',
      data: { fileKey: 'themes/x/intro.mp4' },
    }).expect(201);

    await createAsset({
      kind: 'dialogue',
      name: 'opening',
      data: {
        keepSubtitleAfterEnd: true,
        lines: [
          {
            id: randomUUID(),
            fileKey: 'themes/x/line1.mp3',
            subtitleHtml: '<b>Hi</b>',
          },
          {
            id: randomUUID(),
            fileKey: 'themes/x/line2.mp3',
            subtitleHtml: 'Bye',
          },
        ],
      },
    }).expect(201);

    await createAsset({
      kind: 'hint',
      name: 'first hint',
      code: '9999',
      data: { steps: [{ textHtml: 'look under the desk', imageKey: null }] },
    }).expect(201);

    await createAsset({
      kind: 'player',
      name: 'main player',
      data: {
        speakerDeviceId: deviceId,
        screenDeviceId: screen.body.id as string,
        subtitleCss: 'font-size: 2rem',
      },
    }).expect(201);

    await createAsset({
      kind: 'website',
      name: 'puzzle site',
      data: { url: 'https://example.com/puzzle' },
    }).expect(201);

    await createAsset({
      kind: 'message',
      name: 'unlock msg',
      data: { payload: { action: 'unlock', slot: 3 } },
    }).expect(201);
  });

  it('rejects a duplicate device code with 409', () =>
    createAsset({
      kind: 'device',
      name: 'dup',
      code: 'btn-1',
      data: {},
    }).expect(409));

  it('auto-generates a 4-digit hint code', async () => {
    const hint = await createAsset({
      kind: 'hint',
      name: 'auto hint',
      data: { steps: [{ textHtml: 'step', imageKey: null }] },
    }).expect(201);
    expect(hint.body.code).toMatch(/^\d{4}$/);
  });

  it('rejects wrong-kind data with 400', () =>
    createAsset({ kind: 'bgm', name: 'broken', data: {} }).expect(400));

  it('rejects an unknown kind with 400', () =>
    createAsset({ kind: 'nope', name: 'x', data: {} }).expect(400));

  it('rejects a player referencing a non-device id', async () => {
    const bgm = await createAsset({
      kind: 'bgm',
      name: 'not a device',
      data: { fileKey: 'k' },
    }).expect(201);
    await createAsset({
      kind: 'player',
      name: 'bad player',
      data: {
        speakerDeviceId: bgm.body.id,
        screenDeviceId: bgm.body.id,
        subtitleCss: '',
      },
    }).expect(400);
  });

  it('attaches tags and filters by tag and kind', async () => {
    const tag = await auth(
      request(app.getHttpServer())
        .post(`/api/themes/${themeId}/tags`)
        .send({ name: 'chapter-1', color: '#ff0000' }),
    ).expect(201);
    const tagId = tag.body.id as string;

    const tagged = await createAsset({
      kind: 'sfx',
      name: 'tagged sfx',
      tagIds: [tagId],
      data: { fileKey: 'k' },
    }).expect(201);
    expect(tagged.body.tags).toHaveLength(1);

    const byTag = await auth(
      request(app.getHttpServer()).get(
        `/api/themes/${themeId}/assets?tagId=${tagId}`,
      ),
    ).expect(200);
    expect(byTag.body).toHaveLength(1);
    expect(byTag.body[0].id).toBe(tagged.body.id);

    const byKind = await auth(
      request(app.getHttpServer()).get(
        `/api/themes/${themeId}/assets?kind=device`,
      ),
    ).expect(200);
    expect(
      byKind.body.every((a: { kind: string }) => a.kind === 'device'),
    ).toBe(true);
  });

  it('rejects a tag from outside the theme', () =>
    createAsset({
      kind: 'sfx',
      name: 'x',
      tagIds: [randomUUID()],
      data: { fileKey: 'k' },
    }).expect(400));

  it('updates name, code, and data with kind-checked validation', async () => {
    const hint = await createAsset({
      kind: 'hint',
      name: 'to update',
      data: { steps: [{ textHtml: 'a', imageKey: null }] },
    }).expect(201);
    const id = hint.body.id as string;

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/themes/${themeId}/assets/${id}`)
        .send({
          name: 'updated',
          code: '0001',
          data: { steps: [{ textHtml: 'b', imageKey: 'img.png' }] },
        }),
    ).expect(200);
    expect(updated.body).toMatchObject({ name: 'updated', code: '0001' });

    // data replacement must match the stored kind
    await auth(
      request(app.getHttpServer())
        .patch(`/api/themes/${themeId}/assets/${id}`)
        .send({ data: { fileKey: 'nope' } }),
    ).expect(400);

    // non-coded kinds reject code updates
    const bgm = await createAsset({
      kind: 'bgm',
      name: 'no code',
      data: { fileKey: 'k' },
    }).expect(201);
    await auth(
      request(app.getHttpServer())
        .patch(`/api/themes/${themeId}/assets/${bgm.body.id}`)
        .send({ code: 'x' }),
    ).expect(400);
  });

  it('deletes an asset', async () => {
    const sfx = await createAsset({
      kind: 'sfx',
      name: 'to delete',
      data: { fileKey: 'k' },
    }).expect(201);
    await auth(
      request(app.getHttpServer()).delete(
        `/api/themes/${themeId}/assets/${sfx.body.id}`,
      ),
    ).expect(204);
    await auth(
      request(app.getHttpServer()).get(
        `/api/themes/${themeId}/assets/${sfx.body.id}`,
      ),
    ).expect(404);
  });
});
