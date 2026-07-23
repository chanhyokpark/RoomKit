import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as yauzl from 'yauzl';
import * as yazl from 'yazl';
import type { ThemeExportManifest } from '@roomkit/shared';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp, login } from './helpers';

/** All entries of a zip buffer as name → content. */
function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const entries = new Map<string, Buffer>();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zipfile.readEntry();
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

describe('Theme export/import (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let storage: StorageService;
  const themeIds: string[] = [];

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    for (const id of themeIds) {
      await auth(server().delete(`/api/themes/${id}`));
    }
    await app.close();
  });

  async function fetchObject(key: string): Promise<string> {
    const res = await auth(
      server().get(`/api/files/url?key=${encodeURIComponent(key)}`),
    ).expect(200);
    const fileRes = await fetch(res.body.url as string);
    expect(fileRes.status).toBe(200);
    return fileRes.text();
  }

  it('round-trips a theme with assets, tags, files, and a hosted site', async () => {
    // --- Source theme: tag + device/player/phase/event/bgm/hint/website ---
    const theme = await auth(
      server()
        .post('/api/themes')
        .send({ name: 'transfer e2e', timeLimitMs: 1_800_000 }),
    ).expect(201);
    const themeId = theme.body.id as string;
    themeIds.push(themeId);

    const tag = await auth(
      server()
        .post(`/api/themes/${themeId}/tags`)
        .send({ name: 'chapter-1', color: '#ff0000' }),
    ).expect(201);
    const tagId = tag.body.id as string;

    const createAsset = async (body: object) => {
      const res = await auth(
        server().post(`/api/themes/${themeId}/assets`).send(body),
      ).expect(201);
      return res.body as { id: string };
    };

    const device = await createAsset({
      kind: 'device',
      name: 'screen',
      code: 'dev-1',
      data: { displayName: 'Screen' },
    });
    const player = await createAsset({
      kind: 'player',
      name: 'main player',
      data: {
        speakerDeviceId: device.id,
        screenDeviceId: device.id,
        subtitleCss: '',
      },
    });
    const phase = await createAsset({
      kind: 'phase',
      name: 'intro',
      data: { order: 1 },
    });

    const bgmContent = `bgm-bytes-${Date.now()}`;
    const bgmKey = `themes/${themeId}/${randomUUID()}/track.mp3`;
    await storage.putStream(bgmKey, Readable.from(bgmContent), 'audio/mpeg');
    const bgm = await createAsset({
      kind: 'bgm',
      name: 'main bgm',
      tagIds: [tagId],
      data: { fileKey: bgmKey, durationMs: 2000, fadeInMs: 0, fadeOutMs: 0 },
    });

    // Placeholder media: no file, must survive as a placeholder.
    await createAsset({
      kind: 'sfx',
      name: 'placeholder sfx',
      data: { fileKey: null, durationMs: 1500 },
    });

    const hint = await createAsset({
      kind: 'hint',
      name: 'first hint',
      code: '1234',
      data: { steps: [{ textHtml: '<p>look up</p>', imageKey: null }] },
    });

    const sitePrefix = `sites/${themeId}/${randomUUID()}`;
    const siteHtml = '<html><body>hosted</body></html>';
    await storage.putStream(
      `${sitePrefix}/index.html`,
      Readable.from(siteHtml),
      'text/html',
    );
    const website = await createAsset({
      kind: 'website',
      name: 'puzzle site',
      data: { mode: 'hosted', sitePrefix },
    });

    const event = await createAsset({
      kind: 'event',
      name: 'start',
      data: {
        phaseId: phase.id,
        triggerKind: 'manual',
        triggerName: null,
        manualTriggerable: true,
        allowReentry: false,
        sequence: [
          {
            id: randomUUID(),
            type: 'playBgm',
            bgmId: bgm.id,
            playerId: player.id,
            loop: true,
          },
          {
            id: randomUUID(),
            type: 'showHintCode',
            hintId: hint.id,
            deviceId: device.id,
          },
        ],
      },
    });

    // --- Export ---
    const exportRes = await auth(
      server().get(`/api/themes/${themeId}/export`).responseType('blob'),
    ).expect(200);
    expect(exportRes.headers['content-type']).toContain('application/zip');
    const zip = await readZip(exportRes.body as Buffer);

    const manifest = JSON.parse(
      zip.get('manifest.json')!.toString('utf8'),
    ) as ThemeExportManifest;
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.theme).toEqual({
      name: 'transfer e2e',
      timeLimitMs: 1_800_000,
    });
    expect(manifest.assets).toHaveLength(8);
    expect(zip.get(`files/${bgmKey}`)!.toString('utf8')).toBe(bgmContent);
    expect(zip.get(`files/${sitePrefix}/index.html`)!.toString('utf8')).toBe(
      siteHtml,
    );

    // --- Import ---
    const importRes = await auth(
      server()
        .post('/api/themes/import')
        .attach('file', exportRes.body as Buffer, 'theme.zip'),
    ).expect(201);
    const newThemeId = importRes.body.id as string;
    themeIds.push(newThemeId);
    expect(newThemeId).not.toBe(themeId);
    expect(importRes.body).toMatchObject({
      name: 'transfer e2e',
      timeLimitMs: 1_800_000,
    });

    const imported = await auth(
      server().get(`/api/themes/${newThemeId}/assets`),
    ).expect(200);
    const byName = new Map<string, any>(
      (imported.body as any[]).map((a) => [a.name as string, a]),
    );
    expect(byName.size).toBe(8);

    // Fresh ids, remapped cross-asset refs.
    const newDevice = byName.get('screen');
    expect(newDevice.id).not.toBe(device.id);
    expect(newDevice.code).toBe('dev-1');
    expect(byName.get('main player').data.speakerDeviceId).toBe(newDevice.id);
    const newEvent = byName.get('start');
    expect(newEvent.id).not.toBe(event.id);
    expect(newEvent.data.phaseId).toBe(byName.get('intro').id);
    expect(newEvent.data.sequence[0]).toMatchObject({
      bgmId: byName.get('main bgm').id,
      playerId: byName.get('main player').id,
    });
    expect(newEvent.data.sequence[1]).toMatchObject({
      hintId: byName.get('first hint').id,
      deviceId: newDevice.id,
    });
    expect(byName.get('first hint').code).toBe('1234');

    // Files re-uploaded under keys owned by the new theme, content intact.
    const newBgmKey = byName.get('main bgm').data.fileKey as string;
    expect(newBgmKey).not.toBe(bgmKey);
    expect(newBgmKey.startsWith(`themes/${newThemeId}/`)).toBe(true);
    expect(await fetchObject(newBgmKey)).toBe(bgmContent);

    const newPrefix = byName.get('puzzle site').data.sitePrefix as string;
    expect(newPrefix).not.toBe(sitePrefix);
    expect(newPrefix.startsWith(`sites/${newThemeId}/`)).toBe(true);
    expect(await fetchObject(`${newPrefix}/index.html`)).toBe(siteHtml);
    expect(byName.get('puzzle site').id).not.toBe(website.id);

    // Placeholder stays a placeholder.
    expect(byName.get('placeholder sfx').data).toMatchObject({
      fileKey: null,
      durationMs: 1500,
    });

    // Tag recreated and reattached.
    const newBgmTags = byName.get('main bgm').tags as any[];
    expect(newBgmTags).toHaveLength(1);
    expect(newBgmTags[0]).toMatchObject({
      name: 'chapter-1',
      color: '#ff0000',
    });
    expect(newBgmTags[0].id).not.toBe(tagId);
  });

  async function buildZip(entries: Record<string, string>): Promise<Buffer> {
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(content), name);
    }
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream as unknown as Readable) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  it('imports a hand-written manifest with friendly non-uuid ids', async () => {
    const uuidRe = /^[0-9a-f-]{36}$/;
    const manifest = {
      formatVersion: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      theme: { name: 'hand-written', timeLimitMs: null },
      tags: [
        { id: 't-main', name: 'main', color: '#00ff00' },
        { name: 'unreferenced tag', color: '#0000ff' },
      ],
      assets: [
        {
          id: 'door',
          kind: 'device',
          name: 'door device',
          code: 'door-1',
          data: { displayName: 'Door' },
        },
        {
          id: 'main-player',
          kind: 'player',
          name: 'player',
          data: {
            speakerDeviceId: 'door',
            screenDeviceId: 'door',
            subtitleCss: '',
          },
        },
        { id: 'p1', kind: 'phase', name: 'phase one', data: { order: 1 } },
        {
          id: 'bgm-main',
          kind: 'bgm',
          name: 'theme song',
          tagIds: ['t-main'],
          data: { fileKey: 'audio/theme.mp3' },
        },
        {
          kind: 'dialogue',
          name: 'welcome lines',
          data: {
            keepSubtitleAfterEnd: false,
            // No line id — the importer mints one.
            lines: [{ fileKey: null, subtitleHtml: '<p>hello</p>' }],
          },
        },
        {
          kind: 'event',
          name: 'kickoff',
          data: {
            phaseId: 'p1',
            triggerKind: 'manual',
            triggerName: null,
            manualTriggerable: true,
            allowReentry: false,
            sequence: [
              // No entry id, refs by friendly id, playerId omitted → null.
              { type: 'playBgm', bgmId: 'bgm-main', loop: false },
              { type: 'resetDevice', deviceId: 'door' },
            ],
          },
        },
      ],
    };
    const zipBuffer = await buildZip({
      'manifest.json': JSON.stringify(manifest),
      'files/audio/theme.mp3': 'hand written bgm bytes',
    });

    const importRes = await auth(
      server().post('/api/themes/import').attach('file', zipBuffer, 'hand.zip'),
    ).expect(201);
    const newThemeId = importRes.body.id as string;
    themeIds.push(newThemeId);

    const assets = await auth(
      server().get(`/api/themes/${newThemeId}/assets`),
    ).expect(200);
    const byName = new Map<string, any>(
      (assets.body as any[]).map((a) => [a.name as string, a]),
    );
    expect(byName.size).toBe(6);

    const door = byName.get('door device');
    expect(door.id).toMatch(uuidRe);
    expect(byName.get('player').data).toMatchObject({
      speakerDeviceId: door.id,
      screenDeviceId: door.id,
    });

    const kickoff = byName.get('kickoff');
    expect(kickoff.data.phaseId).toBe(byName.get('phase one').id);
    expect(kickoff.data.sequence[0]).toMatchObject({
      bgmId: byName.get('theme song').id,
      playerId: null,
      loop: false,
    });
    expect(kickoff.data.sequence[1].deviceId).toBe(door.id);
    for (const entry of kickoff.data.sequence) {
      expect(entry.id).toMatch(uuidRe);
    }
    expect(byName.get('welcome lines').data.lines[0].id).toMatch(uuidRe);

    // File referenced by a hand-picked key is re-uploaded under a fresh key.
    const bgmKey = byName.get('theme song').data.fileKey as string;
    expect(bgmKey.startsWith(`themes/${newThemeId}/`)).toBe(true);
    expect(await fetchObject(bgmKey)).toBe('hand written bgm bytes');

    const bgmTags = byName.get('theme song').tags as any[];
    expect(bgmTags).toHaveLength(1);
    expect(bgmTags[0]).toMatchObject({ name: 'main', color: '#00ff00' });
  });

  it('rejects an unknown non-uuid asset reference with a clear error', async () => {
    const manifest = {
      formatVersion: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      theme: { name: 'typo theme', timeLimitMs: null },
      tags: [],
      assets: [
        {
          kind: 'event',
          name: 'broken event',
          data: {
            phaseId: null,
            triggerKind: 'manual',
            triggerName: null,
            manualTriggerable: true,
            allowReentry: false,
            sequence: [{ type: 'resetDevice', deviceId: 'no-such-device' }],
          },
        },
      ],
    };
    const zipBuffer = await buildZip({
      'manifest.json': JSON.stringify(manifest),
    });
    const res = await auth(
      server().post('/api/themes/import').attach('file', zipBuffer, 'typo.zip'),
    ).expect(400);
    expect(res.body.message).toContain('no-such-device');
    expect(res.body.message).toContain('broken event');
  });

  it('rejects a zip without manifest.json', async () => {
    // A valid zip containing a single unrelated file.
    const zipBuffer = await buildZip({ 'readme.txt': 'nope' });
    await auth(
      server().post('/api/themes/import').attach('file', zipBuffer, 'bad.zip'),
    ).expect(400);
  });

  it('404s export for a missing theme', () =>
    auth(
      server().get('/api/themes/00000000-0000-0000-0000-000000000000/export'),
    ).expect(404));
});
