import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type {
  PlaybackProgress,
  SessionMedia,
  SessionNotification,
  SessionRuns,
  WireCommand,
} from '@roomkit/shared';
import { SessionRuntimeService } from '../src/runtime/session-runtime.service';
import type { RuntimeTransport } from '../src/runtime/runtime-transport';
import { createTestApp, login } from './helpers';

interface Sent {
  sessionId: string;
  deviceId: string;
  wire: WireCommand;
}

/** Records outbound traffic; per-device online state is controllable. */
class FakeTransport implements RuntimeTransport {
  sent: Sent[] = [];
  media: SessionMedia[] = [];
  offline = new Set<string>();

  sendCommand(sessionId: string, deviceId: string, wire: WireCommand): boolean {
    if (this.offline.has(deviceId)) return false;
    this.sent.push({ sessionId, deviceId, wire });
    return true;
  }
  sendProgress(_s: string, _d: string, _p: PlaybackProgress): void {}
  sendHint(): boolean {
    return false;
  }
  hasAnyDeviceOnline(): boolean {
    return true;
  }
  broadcastSessionState(): void {}
  broadcastLog(): void {}
  broadcastDeviceStatus(): void {}
  broadcastSessionRuns(_runs: SessionRuns): void {}
  broadcastSessionMedia(media: SessionMedia): void {
    this.media.push(media);
  }
  broadcastNotification(_n: SessionNotification): void {}

  ofType(type: WireCommand['type']): Sent[] {
    return this.sent.filter((s) => s.wire.type === type);
  }
  /** Wires sent since the given cursor (a previous `sent.length`). */
  since(cursor: number): Sent[] {
    return this.sent.slice(cursor);
  }
  get lastMedia(): SessionMedia | undefined {
    return this.media.at(-1);
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timed out');
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

describe('States, phase registrations and reconnect replay (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let runtime: SessionRuntimeService;
  let transport: FakeTransport;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await login(app);
    runtime = app.get(SessionRuntimeService);
  });

  beforeEach(() => {
    transport = new FakeTransport();
    runtime.registerTransport(transport);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await auth(request(app.getHttpServer()).post(`/api/sessions/${id}/end`));
    }
    await app.close();
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

  async function createTheme(): Promise<string> {
    const body = await post('/api/themes', { name: 'state e2e', timeLimitMs: null });
    return body.id as string;
  }

  async function createAsset(themeId: string, input: object): Promise<string> {
    const body = await post(`/api/themes/${themeId}/assets`, input);
    return body.id as string;
  }

  function createDevice(themeId: string, name: string) {
    return createAsset(themeId, {
      kind: 'device',
      name,
      code: `${name}-${randomUUID().slice(0, 8)}`,
      data: { displayName: name },
    });
  }

  async function createSession(themeId: string): Promise<string> {
    const body = await post('/api/sessions', {
      themeId,
      mode: 'test',
      deviceCodes: [],
    });
    sessionIds.push(body.id as string);
    await post(`/api/sessions/${body.id}/start`);
    return body.id as string;
  }

  /** A theme with one device, one player on it, a website, a looping bgm and a state. */
  async function fixture() {
    const themeId = await createTheme();
    const deviceId = await createDevice(themeId, 'stage');
    const playerId = await createAsset(themeId, {
      kind: 'player',
      name: 'main',
      data: { speakerDeviceId: deviceId, screenDeviceId: deviceId, subtitleCss: '' },
    });
    const bgmId = await createAsset(themeId, {
      kind: 'bgm',
      name: 'ambient',
      data: { fileKey: 'themes/test/ambient.mp3' },
    });
    const websiteId = await createAsset(themeId, {
      kind: 'website',
      name: 'panel',
      data: { mode: 'external', url: 'https://example.com/panel' },
    });
    const stateId = await createAsset(themeId, {
      kind: 'state',
      name: 'alarm',
      data: {
        displayName: '경보',
        fields: [
          { key: 'level', label: 'Level', type: 'number', required: true },
          { key: 'label', label: 'Label', type: 'string', required: false },
        ],
      },
    });
    return { themeId, deviceId, playerId, bgmId, websiteId, stateId };
  }

  it('state asset CRUD: validates fields; phase registrations round-trip and are ref-checked', async () => {
    const { themeId, deviceId, stateId, websiteId, playerId, bgmId } = await fixture();

    // invalid field type is rejected
    await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({ kind: 'state', name: 'bad', data: { displayName: '', fields: [{ key: 'x', label: '', type: 'date', required: false }] } }),
    ).expect(400);

    const phaseId = await createAsset(themeId, {
      kind: 'phase',
      name: 'p1',
      data: {
        order: 0,
        deviceStates: [{ deviceId, mode: 'set', stateId, values: { level: 1 } }],
        deviceWebsites: [{ deviceId, mode: 'set', websiteId, query: [{ key: 'q', value: '1' }] }],
        playerBgms: [{ playerId, mode: 'set', bgmId }],
      },
    });
    const got = await auth(request(server()).get(`/api/themes/${themeId}/assets/${phaseId}`)).expect(200);
    expect(got.body.data).toMatchObject({
      order: 0,
      deviceStates: [{ deviceId, mode: 'set', stateId, values: { level: 1 } }],
      deviceWebsites: [{ deviceId, mode: 'set', websiteId, query: [{ key: 'q', value: '1' }] }],
      playerBgms: [{ playerId, mode: 'set', bgmId }],
    });

    // legacy {order} rows parse with defaulted arrays
    const legacyId = await createAsset(themeId, { kind: 'phase', name: 'legacy', data: { order: 1 } });
    const legacy = await auth(request(server()).get(`/api/themes/${themeId}/assets/${legacyId}`)).expect(200);
    expect(legacy.body.data).toEqual({ order: 1, deviceStates: [], deviceWebsites: [], playerBgms: [] });

    // unknown state ref and duplicate device entries are rejected
    await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({ kind: 'phase', name: 'bad-ref', data: { order: 2, deviceStates: [{ deviceId, mode: 'set', stateId: randomUUID(), values: {} }] } }),
    ).expect(400);
    await auth(
      request(server())
        .post(`/api/themes/${themeId}/assets`)
        .send({ kind: 'phase', name: 'dup', data: { order: 3, deviceStates: [{ deviceId, mode: 'none' }, { deviceId, mode: 'none' }] } }),
    ).expect(400);
  });

  it('setState delivers, tracks and replaces; clearState and reset clear; offline state is remembered', async () => {
    const { themeId, deviceId, stateId } = await fixture();
    const sessionId = await createSession(themeId);

    await post(`/api/sessions/${sessionId}/command`, {
      type: 'setState',
      deviceId,
      stateId,
      values: { level: 2, label: 'hi' },
    });
    await waitFor(() => transport.ofType('state').length === 1);
    expect(transport.ofType('state')[0]).toMatchObject({
      deviceId,
      wire: { type: 'state', state: { stateId, stateName: 'alarm', payload: { level: 2, label: 'hi' } } },
    });
    expect(transport.lastMedia!.states).toEqual([
      expect.objectContaining({ deviceId, stateId, stateName: 'alarm', values: { level: 2, label: 'hi' } }),
    ]);

    // a second setState replaces (one state per device)
    await post(`/api/sessions/${sessionId}/command`, { type: 'setState', deviceId, stateId, values: { level: 3 } });
    await waitFor(() => transport.ofType('state').length === 2);
    expect(transport.lastMedia!.states).toHaveLength(1);
    expect(transport.lastMedia!.states[0].values).toEqual({ level: 3 });

    // missing required field → skipped (logged), nothing sent
    await post(`/api/sessions/${sessionId}/command`, { type: 'setState', deviceId, stateId, values: {} });
    await settle(200);
    expect(transport.ofType('state')).toHaveLength(2);

    // clearState → null wire, tracking gone
    await post(`/api/sessions/${sessionId}/command`, { type: 'clearState', deviceId, allDevices: false });
    await waitFor(() => transport.ofType('state').length === 3);
    expect(transport.ofType('state')[2].wire).toMatchObject({ state: null });
    expect(transport.lastMedia!.states).toEqual([]);

    // reset clears a set state too
    await post(`/api/sessions/${sessionId}/command`, { type: 'setState', deviceId, stateId, values: { level: 1 } });
    await waitFor(() => transport.lastMedia?.states.length === 1);
    await post(`/api/sessions/${sessionId}/command`, { type: 'resetDevice', deviceId });
    await waitFor(() => transport.lastMedia?.states.length === 0);

    // offline device: the state is remembered and delivered on connect
    transport.offline.add(deviceId);
    await post(`/api/sessions/${sessionId}/command`, { type: 'setState', deviceId, stateId, values: { level: 9 } });
    await waitFor(() => transport.lastMedia?.states.length === 1);
    const before = transport.sent.length;
    transport.offline.delete(deviceId);
    runtime.onDeviceConnected(sessionId, deviceId);
    await waitFor(() => transport.since(before).some((s) => s.wire.type === 'state'));
    const replay = transport.since(before).find((s) => s.wire.type === 'state')!;
    expect(replay.wire).toMatchObject({ state: { stateId, payload: { level: 9 } } });
  });

  it('phase registrations apply on start/switch idempotently; none clears/unloads/stops', async () => {
    const { themeId, deviceId, playerId, bgmId, websiteId, stateId } = await fixture();
    await createAsset(themeId, {
      kind: 'phase',
      name: 'A',
      data: {
        order: 0,
        deviceStates: [{ deviceId, mode: 'set', stateId, values: { level: 1 } }],
        deviceWebsites: [{ deviceId, mode: 'set', websiteId, query: [] }],
        playerBgms: [{ playerId, mode: 'set', bgmId }],
      },
    });
    // B: identical registrations → nothing should be re-sent
    const phaseB = await createAsset(themeId, {
      kind: 'phase',
      name: 'B',
      data: {
        order: 1,
        deviceStates: [{ deviceId, mode: 'set', stateId, values: { level: 1 } }],
        deviceWebsites: [{ deviceId, mode: 'set', websiteId, query: [] }],
        playerBgms: [{ playerId, mode: 'set', bgmId }],
      },
    });
    // C: keep everything (no slots)
    const phaseC = await createAsset(themeId, { kind: 'phase', name: 'C', data: { order: 2 } });
    // D: none everywhere
    const phaseD = await createAsset(themeId, {
      kind: 'phase',
      name: 'D',
      data: {
        order: 3,
        deviceStates: [{ deviceId, mode: 'none' }],
        deviceWebsites: [{ deviceId, mode: 'none' }],
        playerBgms: [{ playerId, mode: 'none' }],
      },
    });

    // A (order 0) is the initial phase — its registrations apply on start.
    const sessionId = await createSession(themeId);
    await waitFor(
      () =>
        transport.ofType('navigate').length === 1 &&
        transport.ofType('state').length === 1 &&
        transport.ofType('play').length === 1,
    );
    expect(transport.ofType('navigate')[0].wire).toMatchObject({ url: 'https://example.com/panel' });
    expect(transport.ofType('play')[0].wire).toMatchObject({ channel: 'bgm', loop: true, assetId: bgmId });
    // looping bgm acks on start and stays tracked
    runtime.handleAck(sessionId, deviceId, { commandId: transport.ofType('play')[0].wire.id, status: 'done' });
    runtime.handleAck(sessionId, deviceId, { commandId: transport.ofType('navigate')[0].wire.id, status: 'done' });

    // identical phase: nothing re-sent
    let cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: phaseB });
    await settle();
    expect(transport.since(cursor)).toEqual([]);

    // keep phase: nothing re-sent either
    cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: phaseC });
    await settle();
    expect(transport.since(cursor)).toEqual([]);

    // restart re-applies idempotently
    cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase/restart`);
    await settle();
    expect(transport.since(cursor)).toEqual([]);

    // none phase: unload website, clear state, stop bgm
    cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: phaseD });
    await waitFor(() => transport.since(cursor).length === 3);
    const types = transport.since(cursor).map((s) => s.wire.type).sort();
    expect(types).toEqual(['navigate', 'state', 'stop']);
    expect(transport.since(cursor).find((s) => s.wire.type === 'navigate')!.wire).toMatchObject({ websiteId: null, url: null });
    expect(transport.since(cursor).find((s) => s.wire.type === 'state')!.wire).toMatchObject({ state: null });
    expect(transport.lastMedia).toMatchObject({ playing: [], websites: [], states: [] });

    // none again: nothing active → nothing sent
    cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase/restart`);
    await settle();
    expect(transport.since(cursor)).toEqual([]);

    // back to A: everything re-applied
    const phases = (await auth(request(server()).get(`/api/themes/${themeId}/assets?kind=phase`)).expect(200)).body as { id: string; name: string }[];
    const phaseA = phases.find((p) => p.name === 'A')!.id;
    cursor = transport.sent.length;
    await post(`/api/sessions/${sessionId}/phase`, { phaseId: phaseA });
    await waitFor(() => transport.since(cursor).length === 3);
    expect(transport.since(cursor).map((s) => s.wire.type).sort()).toEqual(['navigate', 'play', 'state']);
  });

  it('phase registrations reach a device that was offline when the phase began', async () => {
    const { themeId, deviceId, playerId, bgmId, websiteId, stateId } = await fixture();
    await createAsset(themeId, {
      kind: 'phase',
      name: 'A',
      data: {
        order: 0,
        deviceStates: [{ deviceId, mode: 'set', stateId, values: { level: 1 } }],
        deviceWebsites: [{ deviceId, mode: 'set', websiteId, query: [] }],
        playerBgms: [{ playerId, mode: 'set', bgmId }],
      },
    });
    transport.offline.add(deviceId);
    const sessionId = await createSession(themeId); // initial phase = A
    await settle();
    expect(transport.sent).toEqual([]);
    // the state is remembered even though nothing was delivered
    expect(transport.lastMedia!.states).toHaveLength(1);

    transport.offline.delete(deviceId);
    runtime.onDeviceConnected(sessionId, deviceId);
    await waitFor(() => transport.sent.length >= 3);
    await settle();
    const types = transport.sent.map((s) => s.wire.type).sort();
    expect(types).toEqual(['navigate', 'play', 'state']);
    expect(transport.ofType('play')[0].wire).toMatchObject({ channel: 'bgm', loop: true, assetId: bgmId });
  });

  it('reconnect replays website, state, hint code and looping bgm with fresh ids; in-flight video resumes at an offset', async () => {
    const { themeId, deviceId, playerId, bgmId, websiteId, stateId } = await fixture();
    const hintId = await createAsset(themeId, {
      kind: 'hint',
      name: 'h1',
      code: '4242',
      data: { steps: [{ textHtml: 'step', imageKey: null }] },
    });
    const videoId = await createAsset(themeId, {
      kind: 'video',
      name: 'clip',
      data: { fileKey: 'themes/test/clip.mp4' },
    });
    const sessionId = await createSession(themeId);

    const run = (cmd: object) => post(`/api/sessions/${sessionId}/command`, cmd);
    await run({ type: 'navigate', deviceId, websiteId, query: [] });
    await run({ type: 'setState', deviceId, stateId, values: { level: 5 } });
    await run({ type: 'showHintCode', hintId, deviceId });
    await run({ type: 'playBgm', bgmId, playerId, loop: true, waitUntilEnd: false });
    await run({ type: 'playVideo', videoId, playerId, waitUntilEnd: false });
    await waitFor(() => transport.sent.length === 5);
    const original = [...transport.sent];
    const byType = (t: WireCommand['type']) => original.filter((s) => s.wire.type === t);
    const bgmPlay = original.find((s) => s.wire.type === 'play' && (s.wire as { channel: string }).channel === 'bgm')!;
    const videoPlay = original.find((s) => s.wire.type === 'play' && (s.wire as { channel: string }).channel === 'video')!;

    // Device acks everything apply-type plus the looping bgm start; the video stays in flight.
    for (const s of [...byType('navigate'), ...byType('state'), ...byType('hintCode'), bgmPlay]) {
      runtime.handleAck(sessionId, deviceId, { commandId: s.wire.id, status: 'done' });
    }
    await settle(150);

    const cursor = transport.sent.length;
    runtime.onDeviceConnected(sessionId, deviceId);
    await waitFor(() => transport.since(cursor).length >= 5);
    await settle();
    const replayed = transport.since(cursor);
    expect(replayed).toHaveLength(5);

    const nav = replayed.find((s) => s.wire.type === 'navigate')!;
    expect(nav.wire).toMatchObject({ websiteId, url: 'https://example.com/panel', force: false });
    expect(nav.wire.id).not.toBe(byType('navigate')[0].wire.id);

    const state = replayed.find((s) => s.wire.type === 'state')!;
    expect(state.wire).toMatchObject({ state: { stateId, payload: { level: 5 } } });
    expect(state.wire.id).not.toBe(byType('state')[0].wire.id);

    const hint = replayed.find((s) => s.wire.type === 'hintCode')!;
    expect(hint.wire).toMatchObject({ code: '4242' });
    expect(hint.wire.id).not.toBe(byType('hintCode')[0].wire.id);

    const plays = replayed.filter((s) => s.wire.type === 'play');
    expect(plays).toHaveLength(2);
    const bgmReplay = plays.find((s) => (s.wire as { channel: string }).channel === 'bgm')!;
    expect(bgmReplay.wire).toMatchObject({ channel: 'bgm', loop: true, assetId: bgmId });
    expect(bgmReplay.wire.id).not.toBe(bgmPlay.wire.id);
    expect((bgmReplay.wire as { offsetMs?: number }).offsetMs).toBeGreaterThanOrEqual(0);
    const videoReplay = plays.find((s) => (s.wire as { channel: string }).channel === 'video')!;
    expect(videoReplay.wire.id).toBe(videoPlay.wire.id); // same id: still unacked
    expect((videoReplay.wire as { offsetMs?: number }).offsetMs).toBeGreaterThanOrEqual(100);

    // tracking still shows exactly one website/state and the bgm+video
    const media = transport.lastMedia!;
    expect(media.websites).toHaveLength(1);
    expect(media.states).toHaveLength(1);
    expect(media.playing.map((p) => p.channel).sort()).toEqual(['bgm', 'video']);
    expect(media.playing.find((p) => p.channel === 'bgm')!.commandId).toBe(bgmReplay.wire.id);
  });

  it('a device with nothing active gets its start website on connect (still), not a phantom replay', async () => {
    const { themeId, deviceId, websiteId } = await fixture();
    const startId = await createAsset(themeId, {
      kind: 'device',
      name: 'lobby',
      code: `lobby-${randomUUID().slice(0, 8)}`,
      data: { displayName: 'lobby', startWebsite: { websiteId, query: [] } },
    });
    const sessionId = await createSession(themeId);
    await waitFor(() => transport.ofType('navigate').length === 1);
    expect(transport.ofType('navigate')[0].deviceId).toBe(startId);

    const cursor = transport.sent.length;
    runtime.onDeviceConnected(sessionId, deviceId);
    await settle();
    expect(transport.since(cursor)).toEqual([]);
  });
});
