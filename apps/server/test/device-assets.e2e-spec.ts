import { INestApplication } from '@nestjs/common';
import {
  DeviceAssetManifestSchema,
  type DeviceAssetManifest,
} from '@roomkit/shared';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import {
  connectDevice,
  createSocketTestApp,
  login,
  nextTestCode,
  waitForEvent,
} from './helpers';

describe('Device asset manifest (e2e)', () => {
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

  function device(code: string): Socket {
    const socket = connectDevice(url, code);
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

  async function createAsset(themeId: string, input: object): Promise<string> {
    return (await post(`/api/themes/${themeId}/assets`, input)).id;
  }

  function requestManifest(socket: Socket): Promise<DeviceAssetManifest> {
    return new Promise((resolve, reject) => {
      socket
        .timeout(3000)
        .emit('assets:manifest', {}, (err: Error | null, ack: unknown) => {
          if (err) return reject(err);
          const parsed = DeviceAssetManifestSchema.safeParse(ack);
          if (!parsed.success) {
            return reject(
              new Error(`Invalid manifest ack: ${JSON.stringify(ack)}`),
            );
          }
          resolve(parsed.data);
        });
    });
  }

  const fileKeysOf = (m: DeviceAssetManifest) =>
    m.entries.map((e) => e.fileKey).sort();

  const KEYS = {
    bgm: 'themes/e2e/bgm-uuid/ambience.mp3',
    sfx: 'themes/e2e/sfx-uuid/klaxon.mp3',
    video: 'themes/e2e/video-uuid/intro.mp4',
    line1: 'themes/e2e/dlg-uuid/line-01.mp3',
    line2: 'themes/e2e/dlg-uuid/line-02.mp3',
  };

  /**
   * Theme with a speaker-only, a screen-only, a combo (speaker+screen), and an
   * unwired device, plus one media asset of each kind and a hint image (which
   * must never appear in manifests).
   */
  async function fixture() {
    const themeId = (
      await post('/api/themes', { name: 'manifest e2e', timeLimitMs: null })
    ).id as string;
    const dev = async (name: string) =>
      createAsset(themeId, {
        kind: 'device',
        name,
        code: `${name}-${Math.random().toString(36).slice(2, 10)}`,
        data: { displayName: name },
      });
    const speakerId = await dev('speaker');
    const screenId = await dev('screen');
    const comboId = await dev('combo');
    const plainId = await dev('plain');
    await createAsset(themeId, {
      kind: 'player',
      name: 'main-player',
      data: {
        speakerDeviceId: speakerId,
        screenDeviceId: screenId,
        subtitleCss: '',
      },
    });
    await createAsset(themeId, {
      kind: 'player',
      name: 'combo-player',
      data: {
        speakerDeviceId: comboId,
        screenDeviceId: comboId,
        subtitleCss: '',
      },
    });
    await createAsset(themeId, {
      kind: 'bgm',
      name: 'ambience',
      data: { fileKey: KEYS.bgm },
    });
    await createAsset(themeId, {
      kind: 'sfx',
      name: 'klaxon',
      data: { fileKey: KEYS.sfx },
    });
    await createAsset(themeId, {
      kind: 'video',
      name: 'intro',
      data: { fileKey: KEYS.video },
    });
    await createAsset(themeId, {
      kind: 'dialogue',
      name: 'opening',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            fileKey: KEYS.line1,
            subtitleHtml: '<p>one</p>',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            fileKey: KEYS.line2,
            subtitleHtml: '<p>two</p>',
          },
        ],
      },
    });
    await createAsset(themeId, {
      kind: 'hint',
      name: 'hint-with-image',
      data: {
        steps: [{ textHtml: '<p>hint</p>', imageKey: 'themes/e2e/hint.png' }],
      },
    });
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [speakerId, screenId, comboId, plainId].map((deviceId) => ({
        deviceId,
        code: nextTestCode(),
      })),
    });
    sessionIds.push(session.id as string);
    const codeOf = (deviceId: string) =>
      (session.testDeviceCodes as { deviceId: string; code: string }[]).find(
        (c) => c.deviceId === deviceId,
      )!.code;
    return {
      themeId,
      deviceIds: { speakerId, screenId, comboId, plainId },
      codes: {
        speaker: codeOf(speakerId),
        screen: codeOf(screenId),
        combo: codeOf(comboId),
        plain: codeOf(plainId),
      },
    };
  }

  async function attachedManifest(code: string): Promise<DeviceAssetManifest> {
    const socket = device(code);
    await waitForEvent(socket, 'welcome');
    return requestManifest(socket);
  }

  it('gives speaker devices all audio (bgm, sfx, dialogue lines) but no video', async () => {
    const { themeId, deviceIds, codes } = await fixture();
    const manifest = await attachedManifest(codes.speaker);

    expect(manifest.themeId).toBe(themeId);
    expect(manifest.deviceId).toBe(deviceIds.speakerId);
    expect(manifest.urlExpiresAt).toBeGreaterThan(Date.now());
    expect(fileKeysOf(manifest)).toEqual(
      [KEYS.bgm, KEYS.sfx, KEYS.line1, KEYS.line2].sort(),
    );
    // dialogue entries carry their line id; every url is presigned for its key
    const line = manifest.entries.find((e) => e.fileKey === KEYS.line1)!;
    expect(line.kind).toBe('dialogue');
    expect(line.lineId).toBe('11111111-1111-4111-8111-111111111111');
    for (const entry of manifest.entries) {
      expect(entry.url).toContain(entry.fileKey.split('/').pop()!);
    }
  });

  it('gives screen devices only video', async () => {
    const { codes } = await fixture();
    const manifest = await attachedManifest(codes.screen);
    expect(fileKeysOf(manifest)).toEqual([KEYS.video]);
  });

  it('gives combo (speaker+screen) devices the union', async () => {
    const { codes } = await fixture();
    const manifest = await attachedManifest(codes.combo);
    expect(fileKeysOf(manifest)).toEqual(
      [KEYS.bgm, KEYS.sfx, KEYS.video, KEYS.line1, KEYS.line2].sort(),
    );
  });

  it('gives devices wired into no player an empty manifest', async () => {
    const { codes } = await fixture();
    const manifest = await attachedManifest(codes.plain);
    expect(manifest.entries).toEqual([]);
  });

  it('serves lobby-parked production devices (pre-start downloads)', async () => {
    // Fresh theme, production device code, no session at all.
    const themeId = (
      await post('/api/themes', {
        name: 'manifest lobby e2e',
        timeLimitMs: null,
      })
    ).id as string;
    const code = `lobby-${Math.random().toString(36).slice(2, 10)}`;
    const deviceId = await createAsset(themeId, {
      kind: 'device',
      name: 'lobby-speaker',
      code,
      data: { displayName: 'lobby' },
    });
    await createAsset(themeId, {
      kind: 'player',
      name: 'p',
      data: {
        speakerDeviceId: deviceId,
        screenDeviceId: deviceId,
        subtitleCss: '',
      },
    });
    await createAsset(themeId, {
      kind: 'bgm',
      name: 'b',
      data: { fileKey: 'themes/e2e/lobby/bgm.mp3' },
    });

    const socket = device(code);
    await waitForEvent(socket, 'connect');
    const manifest = await requestManifest(socket);
    expect(manifest.themeId).toBe(themeId);
    expect(manifest.deviceId).toBe(deviceId);
    expect(fileKeysOf(manifest)).toEqual(['themes/e2e/lobby/bgm.mp3']);
  });

  it('re-requests return fresh manifests over the same socket', async () => {
    const { codes } = await fixture();
    const socket = device(codes.speaker);
    await waitForEvent(socket, 'welcome');
    const first = await requestManifest(socket);
    const second = await requestManifest(socket);
    expect(fileKeysOf(second)).toEqual(fileKeysOf(first));
  });
});
