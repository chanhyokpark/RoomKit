import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RoomKitClient, testCodeKey } from '@roomkit/client';
import type {
  HintError,
  HintShow,
  PlaybackProgress,
  Welcome,
  WirePlayCommand,
  WirePlayDialogue,
} from '@roomkit/shared';
import request from 'supertest';
import { createSocketTestApp, login, nextTestCode } from './helpers';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

function waitFor<T>(
  register: (resolve: (v: T) => void) => void,
  timeoutMs = 3000,
) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('waitFor timed out')),
      timeoutMs,
    );
    register((v) => {
      clearTimeout(timeout);
      resolve(v);
    });
  });
}

describe('@roomkit/client (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let token: string;
  const clients: RoomKitClient[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    ({ app, url } = await createSocketTestApp());
    token = await login(app);
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    for (const id of sessionIds) {
      await auth(request(app.getHttpServer()).post(`/api/sessions/${id}/end`));
    }
    await app.close();
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  function client(
    deviceCode: string,
    storage = new MemoryStorage(),
  ): RoomKitClient {
    const c = new RoomKitClient({ serverUrl: url, deviceCode, storage });
    clients.push(c);
    return c;
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

  const entry = (cmd: object) => ({ id: randomUUID(), ...cmd });

  async function fixture() {
    const themeId = (
      await post('/api/themes', { name: 'client e2e', timeLimitMs: null })
    ).id as string;
    const mk = async (input: object) =>
      (await post(`/api/themes/${themeId}/assets`, input)).id as string;
    const speakerId = await mk({
      kind: 'device',
      name: 'speaker',
      code: `spk-${randomUUID().slice(0, 8)}`,
      data: { displayName: '스피커' },
    });
    // The screen doubles as the hint device for the client hint API tests.
    const screenId = await mk({
      kind: 'device',
      name: 'screen',
      code: `scr-${randomUUID().slice(0, 8)}`,
      data: { displayName: '스크린', isHintDevice: true },
    });
    const playerId = await mk({
      kind: 'player',
      name: 'split-player',
      data: {
        speakerDeviceId: speakerId,
        screenDeviceId: screenId,
        subtitleCss: '.sub{}',
      },
    });
    const dialogueId = await mk({
      kind: 'dialogue',
      name: 'talk',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [
          { id: randomUUID(), fileKey: 'themes/c/l1.mp3', subtitleHtml: 'one' },
          { id: randomUUID(), fileKey: 'themes/c/l2.mp3', subtitleHtml: 'two' },
        ],
      },
    });
    const messageId = await mk({
      kind: 'message',
      name: 'done-signal',
      data: { displayName: 'done-signal', fields: [] },
    });
    const hintId = await mk({
      kind: 'hint',
      name: 'first-puzzle',
      code: '0707',
      data: {
        steps: [
          { textHtml: '<p>h1</p>', imageKey: null },
          { textHtml: '<p>h2</p>', imageKey: null },
        ],
      },
    });
    await mk({
      kind: 'event',
      name: 'talk-on-button',
      data: {
        phaseId: null,
        triggerKind: 'device',
        triggerName: 'button',
        manualTriggerable: false,
        allowReentry: true,
        sequence: [
          entry({
            type: 'playDialogue',
            dialogueId,
            playerId,
            waitUntilEnd: true,
          }),
          entry({
            type: 'sendMessage',
            deviceId: screenId,
            messageId,
            values: {},
          }),
        ],
      },
    });
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [
        { deviceId: speakerId, code: nextTestCode() },
        { deviceId: screenId, code: nextTestCode() },
      ],
    });
    sessionIds.push(session.id as string);
    await post(`/api/sessions/${session.id}/start`);
    const codes = session.testDeviceCodes as {
      deviceId: string;
      code: string;
    }[];
    return {
      themeId,
      speakerId,
      screenId,
      hintId,
      speakerCode: codes.find((c) => c.deviceId === speakerId)!.code,
      screenCode: codes.find((c) => c.deviceId === screenId)!.code,
      sessionId: session.id as string,
    };
  }

  it('connects, receives welcome, and persists the test code', async () => {
    const { speakerCode, sessionId } = await fixture();
    const storage = new MemoryStorage();
    const rk = client(speakerCode, storage);

    const welcomePromise = waitFor<Welcome>((res) => rk.on('welcome', res));
    rk.connect();
    const welcome = await welcomePromise;
    expect(welcome.device.displayName).toBe('스피커');
    expect(welcome.session.sessionId).toBe(sessionId);
    expect(rk.status).toBe('connected');
    expect(rk.sessionState?.mode).toBe('test');
    expect(storage.getItem(testCodeKey(url))).toBe(speakerCode);
  });

  it('a stored test code overrides the configured device code', async () => {
    const { speakerCode, sessionId } = await fixture();
    const storage = new MemoryStorage();
    storage.setItem(testCodeKey(url), speakerCode);
    const rk = client('some-production-code', storage);

    const welcomePromise = waitFor<Welcome>((res) => rk.on('welcome', res));
    rk.connect();
    expect((await welcomePromise).session.sessionId).toBe(sessionId);
  });

  it('fatal connect errors stop the client and clear the stored code', async () => {
    const storage = new MemoryStorage();
    storage.setItem(testCodeKey(url), 'not-a-real-code');
    const rk = client('not-a-real-code', storage);

    const errorPromise = waitFor<string | undefined>((res) =>
      rk.on('status', (s, detail) => {
        if (s === 'error') res(detail);
      }),
    );
    rk.connect();
    expect(await errorPromise).toBe('invalid_code');
    expect(storage.getItem(testCodeKey(url))).toBeNull();
  });

  it('dispatches play with done() resolving waitUntilEnd, dedupes redelivery', async () => {
    const { speakerCode, screenCode } = await fixture();
    const speaker = client(speakerCode);
    const screen = client(screenCode);

    const plays: WirePlayCommand[] = [];
    let done: (() => void) | null = null;
    speaker.on('play', (cmd, d) => {
      plays.push(cmd);
      done = () => d();
    });
    const screenReady = waitFor<Welcome>((res) => screen.on('welcome', res));
    const screenMessage = waitFor<unknown>((res) => screen.on('message', res));
    const speakerReady = waitFor<Welcome>((res) => speaker.on('welcome', res));
    speaker.connect();
    screen.connect();
    await Promise.all([speakerReady, screenReady]);

    speaker.trigger('button');
    await waitFor<void>((res) => {
      const check = () => (plays.length > 0 ? res() : setTimeout(check, 25));
      check();
    });
    expect(plays[0]).toMatchObject({ channel: 'dialogue', role: 'speaker' });

    // reconnect before acking: the redelivered command must not re-dispatch
    speaker.disconnect();
    speaker.connect();
    await waitFor<Welcome>((res) => speaker.on('welcome', res));
    await new Promise((r) => setTimeout(r, 300));
    expect(plays).toHaveLength(1);

    // done() acks on the new socket and the sequence proceeds to sendMessage
    done!();
    await screenMessage;
  });

  it('relays dialogue progress from speaker to screen with the screen command id', async () => {
    const { speakerCode, screenCode } = await fixture();
    const speaker = client(speakerCode);
    const screen = client(screenCode);

    let speakerPlay: WirePlayDialogue | null = null;
    let screenPlay: WirePlayDialogue | null = null;
    speaker.on('play', (cmd) => (speakerPlay = cmd as WirePlayDialogue));
    screen.on('play', (cmd) => (screenPlay = cmd as WirePlayDialogue));
    const progressPromise = waitFor<PlaybackProgress>((res) =>
      screen.on('progress', res),
    );

    const ready = Promise.all([
      waitFor<Welcome>((res) => speaker.on('welcome', res)),
      waitFor<Welcome>((res) => screen.on('welcome', res)),
    ]);
    speaker.connect();
    screen.connect();
    await ready;

    speaker.trigger('button');
    await waitFor<void>((res) => {
      const check = () =>
        speakerPlay && screenPlay ? res() : setTimeout(check, 25);
      check();
    });
    expect(speakerPlay!.role).toBe('speaker');
    expect(screenPlay!.role).toBe('screen');
    expect(screenPlay!.lines.map((l) => l.subtitleHtml)).toEqual([
      'one',
      'two',
    ]);

    speaker.sendProgress(speakerPlay!.id, 1);
    const progress = await progressPromise;
    expect(progress.lineIndex).toBe(1);
    expect(progress.commandId).toBe(screenPlay!.id); // rewritten by the relay
  });

  it('retryOnFatalError polls until the code exists (device pre-boot)', async () => {
    const code = nextTestCode();
    const storage = new MemoryStorage();
    const rk = new RoomKitClient({
      serverUrl: url,
      deviceCode: code,
      storage,
      retryOnFatalError: true,
      fatalRetryDelayMs: 150,
    });
    clients.push(rk);
    const statuses: string[] = [];
    rk.on('status', (s) => statuses.push(s));
    const welcomePromise = waitFor<Welcome>(
      (res) => rk.on('welcome', res),
      5000,
    );
    rk.connect();

    // Let at least one invalid_code cycle pass: still polling, never 'error'.
    await new Promise((r) => setTimeout(r, 400));
    expect(rk.status).toBe('connecting');
    expect(statuses).not.toContain('error');

    // The operator now creates the test session using that code.
    const themeId = (
      await post('/api/themes', { name: 'preboot e2e', timeLimitMs: null })
    ).id as string;
    const deviceId = (
      await post(`/api/themes/${themeId}/assets`, {
        kind: 'device',
        name: 'preboot',
        code: `pre-${randomUUID().slice(0, 8)}`,
        data: { displayName: '프리부트' },
      })
    ).id as string;
    const session = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [{ deviceId, code }],
    });
    sessionIds.push(session.id as string);

    const welcome = await welcomePromise;
    expect(welcome.session.mode).toBe('test');
    expect(welcome.device.id).toBe(deviceId);
    expect(rk.status).toBe('connected');
  });

  it('submits hint codes and requests steps via the hint API', async () => {
    const { screenCode, hintId } = await fixture();
    const rk = client(screenCode);
    const ready = waitFor<Welcome>((res) => rk.on('welcome', res));
    rk.connect();
    await ready;

    const shown = waitFor<HintShow>((res) => rk.on('hint', res));
    rk.submitHint('0707');
    expect(await shown).toMatchObject({
      hintId,
      code: '0707',
      step: 0,
      stepCount: 2,
      textHtml: '<p>h1</p>',
    });

    const next = waitFor<HintShow>((res) => rk.on('hint', res));
    rk.requestHintStep(hintId, 1);
    expect(await next).toMatchObject({
      hintId,
      step: 1,
      textHtml: '<p>h2</p>',
    });

    const error = waitFor<HintError>((res) => rk.on('hintError', res));
    rk.submitHint('9999');
    expect(await error).toMatchObject({ reason: 'unknown_code', code: '9999' });
  });

  it('fetches the device asset manifest', async () => {
    const { speakerCode, screenCode, speakerId } = await fixture();
    const speaker = client(speakerCode);
    const screen = client(screenCode);
    const ready = Promise.all([
      waitFor<Welcome>((res) => speaker.on('welcome', res)),
      waitFor<Welcome>((res) => screen.on('welcome', res)),
    ]);
    speaker.connect();
    screen.connect();
    await ready;

    // speaker side of the player: the dialogue's line files
    const manifest = await speaker.fetchAssetManifest();
    expect(manifest.deviceId).toBe(speakerId);
    expect(manifest.urlExpiresAt).toBeGreaterThan(Date.now());
    expect(manifest.entries.map((e) => e.fileKey).sort()).toEqual([
      'themes/c/l1.mp3',
      'themes/c/l2.mp3',
    ]);

    // screen side: the theme has no video assets
    expect((await screen.fetchAssetManifest()).entries).toEqual([]);
  });
});
