import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  HelperToPlayerSchema,
  type HintError,
  type HintShow,
  type PlayerMessage,
} from '@roomkit/shared';
import { RoomKitHelper, type RoomKitHelperOptions } from './helper.js';
import { HELPER_VERSION } from './version.js';

type Listener = (event: { data: unknown }) => void;

/** Fake iframe environment: capture outbound posts, allow injecting inbound. */
function env(
  options: Pick<RoomKitHelperOptions, 'renders' | 'messages' | 'testCallbacks'> = {},
) {
  const posted: unknown[] = [];
  const listeners = new Set<Listener>();
  const helper = new RoomKitHelper({
    ...options,
    parentWindow: {
      postMessage: ((message: unknown) => void posted.push(message)) as Window['postMessage'],
    },
    selfWindow: {
      addEventListener: ((_: string, l: Listener) => void listeners.add(l)) as Window['addEventListener'],
      removeEventListener: ((_: string, l: Listener) => void listeners.delete(l)) as Window['removeEventListener'],
    },
  });
  const inject = (data: unknown) => {
    for (const l of [...listeners]) l({ data });
  };
  return { helper, posted, listeners, inject };
}

const HINT: HintShow = {
  hintId: '11111111-1111-4111-8111-111111111111',
  code: '0417',
  step: 0,
  stepCount: 2,
  textHtml: '<p>hint</p>',
  imageUrl: null,
};

describe('RoomKitHelper', () => {
  it('posts hello on construction, with the helper source and no claims by default', () => {
    const { posted } = env();
    expect(posted).toEqual([
      {
        source: 'roomkit-helper',
        type: 'hello',
        renders: { subtitle: false, hintCode: false, video: false },
        version: HELPER_VERSION,
        messages: [],
        testCallbacks: [],
      },
    ]);
    expect(HelperToPlayerSchema.parse(posted[0])).toMatchObject({ type: 'hello' });
  });

  it('hello carries partial render claims, schema-valid', () => {
    const { posted } = env({ renders: { subtitle: true, video: true } });
    expect(HelperToPlayerSchema.parse(posted[0])).toEqual({
      source: 'roomkit-helper',
      type: 'hello',
      renders: { subtitle: true, hintCode: false, video: true },
      version: HELPER_VERSION,
      messages: [],
      testCallbacks: [],
    });
  });

  it('hello reports registered message and test-callback names', () => {
    const { posted } = env({
      messages: { unlock: () => {}, lock: () => {} },
      testCallbacks: { 'reset-puzzle': () => {} },
    });
    expect(HelperToPlayerSchema.parse(posted[0])).toMatchObject({
      type: 'hello',
      messages: ['unlock', 'lock'],
      testCallbacks: ['reset-puzzle'],
    });
  });

  it('HELPER_VERSION matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(HELPER_VERSION).toBe(pkg.version);
  });

  it('posts trigger envelopes that parse against the shared schema', () => {
    const { helper, posted } = env();
    helper.trigger('door-open', { count: 1 });
    helper.trigger('plain');
    const [, withPayload, bare] = posted;
    expect(HelperToPlayerSchema.parse(withPayload)).toEqual({
      source: 'roomkit-helper',
      type: 'trigger',
      event: 'door-open',
      payload: { count: 1 },
    });
    // payload key omitted entirely when undefined
    expect(bare).toEqual({
      source: 'roomkit-helper',
      type: 'trigger',
      event: 'plain',
    });
    expect(HelperToPlayerSchema.parse(bare)).not.toHaveProperty('payload');
  });

  it('triggerAndWait posts a requestId trigger and resolves on an ok result', async () => {
    const { helper, posted, inject } = env();
    const promise = helper.triggerAndWait('door-open', { count: 1 });
    const request = HelperToPlayerSchema.parse(posted[1]);
    expect(request).toMatchObject({
      source: 'roomkit-helper',
      type: 'trigger',
      event: 'door-open',
      payload: { count: 1 },
    });
    const requestId = (request as { requestId: string }).requestId;
    inject({ source: 'roomkit-player', type: 'trigger:result', requestId, ok: true });
    await expect(promise).resolves.toBeUndefined();
  });

  it('triggerAndWait rejects on ok:false, ignores other requests, times out', async () => {
    vi.useFakeTimers();
    try {
      const { helper, posted, inject } = env();
      const failing = helper.triggerAndWait('a');
      const requestId = (HelperToPlayerSchema.parse(posted[1]) as { requestId: string })
        .requestId;
      inject({ source: 'roomkit-player', type: 'trigger:result', requestId, ok: false });
      await expect(failing).rejects.toThrow('trigger failed');

      const timingOut = helper.triggerAndWait('b', undefined, { timeoutMs: 1000 });
      inject({
        source: 'roomkit-player',
        type: 'trigger:result',
        requestId: '33333333-3333-4333-8333-333333333333',
        ok: true,
      });
      vi.advanceTimersByTime(1000);
      await expect(timingOut).rejects.toThrow('trigger wait timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts hint submit/next envelopes that parse against the shared schema', () => {
    const { helper, posted } = env();
    helper.submitHint('0417');
    helper.requestHintStep(HINT.hintId, 1);
    expect(HelperToPlayerSchema.parse(posted[1])).toEqual({
      source: 'roomkit-helper',
      type: 'hint:submit',
      code: '0417',
    });
    expect(HelperToPlayerSchema.parse(posted[2])).toEqual({
      source: 'roomkit-helper',
      type: 'hint:next',
      hintId: HINT.hintId,
      step: 1,
    });
  });

  it('dispatches player message envelopes as (payload, envelope)', () => {
    const { helper, inject } = env();
    const onMessage = vi.fn();
    helper.on('message', onMessage);
    const envelope: PlayerMessage = {
      source: 'roomkit-player',
      type: 'message',
      messageId: '22222222-2222-4222-8222-222222222222',
      messageName: 'unlock',
      payload: { door: 'north', open: true },
    };
    inject(envelope);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(
      { door: 'north', open: true },
      envelope,
    );
  });

  describe('awaited messages (commandId set)', () => {
    const commandId = '66666666-6666-4666-8666-666666666666';
    const awaited: PlayerMessage = {
      source: 'roomkit-player',
      type: 'message',
      messageId: '22222222-2222-4222-8222-222222222222',
      messageName: 'unlock',
      payload: { door: 'north' },
      commandId,
    };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('posts message:done ok:true only after every async handler resolves', async () => {
      const { helper, posted, inject } = env();
      let releaseA!: () => void;
      let releaseB!: () => void;
      helper.on('message', () => new Promise<void>((r) => (releaseA = r)));
      helper.on('message', () => new Promise<void>((r) => (releaseB = r)));
      inject(awaited);
      releaseA();
      await flush();
      expect(posted).toHaveLength(1); // hello only — B still pending
      releaseB();
      await flush();
      expect(HelperToPlayerSchema.parse(posted[1])).toEqual({
        source: 'roomkit-helper',
        type: 'message:done',
        commandId,
        ok: true,
      });
    });

    it('sync handlers (and no handlers) settle immediately with ok:true', async () => {
      const { helper, posted, inject } = env();
      const sync = () => undefined;
      helper.on('message', sync);
      inject(awaited);
      await flush();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'message:done',
        ok: true,
      });
      helper.off('message', sync);
      inject(awaited);
      await flush();
      // No listeners: still answered, immediately ok.
      expect(HelperToPlayerSchema.parse(posted[2])).toMatchObject({
        type: 'message:done',
        ok: true,
      });
    });

    it('a rejecting handler posts ok:false without blocking other handlers', async () => {
      const { helper, posted, inject } = env();
      const other = vi.fn();
      helper.on('message', () => Promise.reject(new Error('boom')));
      helper.on('message', other);
      inject(awaited);
      await flush();
      expect(other).toHaveBeenCalledOnce();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'message:done',
        commandId,
        ok: false,
      });
    });

    it('a synchronously throwing handler posts ok:false, later handlers still run', async () => {
      const { helper, posted, inject } = env();
      const other = vi.fn();
      helper.on('message', () => {
        throw new Error('boom');
      });
      helper.on('message', other);
      inject(awaited);
      await flush();
      expect(other).toHaveBeenCalledOnce();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'message:done',
        ok: false,
      });
    });

    it('posts nothing for messages without a commandId', async () => {
      const { helper, posted, inject } = env();
      helper.on('message', () => Promise.resolve());
      inject({ ...awaited, commandId: undefined });
      await flush();
      expect(posted).toHaveLength(1); // hello only
    });

    it('a named handler is dispatched by messageName and awaited', async () => {
      const unlock = vi.fn();
      const other = vi.fn();
      const { posted, inject } = env({ messages: { unlock, other } });
      inject(awaited);
      await flush();
      expect(unlock).toHaveBeenCalledExactlyOnceWith({ door: 'north' }, awaited);
      expect(other).not.toHaveBeenCalled();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'message:done',
        commandId,
        ok: true,
      });
    });

    it('a rejecting named handler posts ok:false; legacy listeners still run', async () => {
      const legacy = vi.fn();
      const { helper, posted, inject } = env({
        messages: { unlock: () => Promise.reject(new Error('boom')) },
      });
      helper.on('message', legacy);
      inject(awaited);
      await flush();
      expect(legacy).toHaveBeenCalledOnce();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'message:done',
        ok: false,
      });
    });

    it('a named handler also runs for fire-and-forget messages', async () => {
      const unlock = vi.fn();
      const { posted, inject } = env({ messages: { unlock } });
      inject({ ...awaited, commandId: undefined });
      await flush();
      expect(unlock).toHaveBeenCalledOnce();
      expect(posted).toHaveLength(1); // hello only — nothing to ack
    });
  });

  describe('test callbacks', () => {
    const requestId = '77777777-7777-4777-8777-777777777777';
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('runs a registered callback and posts a schema-valid ok:true done', async () => {
      const cb = vi.fn();
      const { posted, inject } = env({ testCallbacks: { 'reset-puzzle': cb } });
      inject({
        source: 'roomkit-player',
        type: 'test:callback',
        requestId,
        name: 'reset-puzzle',
      });
      await flush();
      expect(cb).toHaveBeenCalledOnce();
      expect(HelperToPlayerSchema.parse(posted[1])).toEqual({
        source: 'roomkit-helper',
        type: 'test:callback:done',
        requestId,
        ok: true,
      });
    });

    it('unknown names and throwing callbacks post ok:false', async () => {
      const { posted, inject } = env({
        testCallbacks: {
          boom: () => {
            throw new Error('boom');
          },
        },
      });
      inject({
        source: 'roomkit-player',
        type: 'test:callback',
        requestId,
        name: 'nope',
      });
      await flush();
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'test:callback:done',
        ok: false,
      });
      inject({
        source: 'roomkit-player',
        type: 'test:callback',
        requestId,
        name: 'boom',
      });
      await flush();
      expect(HelperToPlayerSchema.parse(posted[2])).toMatchObject({
        type: 'test:callback:done',
        ok: false,
      });
    });
  });

  it('dispatches hint:show and hint:error', () => {
    const { helper, inject } = env();
    const onHint = vi.fn();
    const onError = vi.fn();
    helper.on('hint', onHint).on('hintError', onError);
    inject({ source: 'roomkit-player', type: 'hint:show', hint: HINT });
    const error: HintError = { reason: 'unknown_code', code: '9999' };
    inject({ source: 'roomkit-player', type: 'hint:error', error });
    expect(onHint).toHaveBeenCalledExactlyOnceWith(HINT);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('posts video ended/error envelopes that parse against the shared schema', () => {
    const { helper, posted } = env();
    const commandId = '44444444-4444-4444-8444-444444444444';
    helper.videoEnded(commandId);
    helper.videoError(commandId);
    expect(HelperToPlayerSchema.parse(posted[1])).toEqual({
      source: 'roomkit-helper',
      type: 'video:ended',
      commandId,
    });
    expect(HelperToPlayerSchema.parse(posted[2])).toEqual({
      source: 'roomkit-helper',
      type: 'video:error',
      commandId,
    });
  });

  it('dispatches subtitle and hintCode payloads, including null clears', () => {
    const { helper, inject } = env({ renders: { subtitle: true, hintCode: true } });
    const onSubtitle = vi.fn();
    const onHintCode = vi.fn();
    helper.on('subtitle', onSubtitle).on('hintCode', onHintCode);
    const subtitle = {
      html: '<em>hi</em>',
      css: '.rk-subtitle{color:red}',
      params: { speaker: 'captain' },
      lineIndex: 0,
      lineCount: 2,
    };
    inject({ source: 'roomkit-player', type: 'subtitle', subtitle });
    inject({ source: 'roomkit-player', type: 'subtitle', subtitle: null });
    const hintCode = { code: '4242', css: '', params: {} };
    inject({ source: 'roomkit-player', type: 'hintCode', hintCode });
    inject({ source: 'roomkit-player', type: 'hintCode', hintCode: null });
    expect(onSubtitle.mock.calls).toEqual([[subtitle], [null]]);
    expect(onHintCode.mock.calls).toEqual([[hintCode], [null]]);
  });

  it('dispatches videoPlay and videoStop', () => {
    const { helper, inject } = env({ renders: { video: true } });
    const onPlay = vi.fn();
    const onStop = vi.fn();
    helper.on('videoPlay', onPlay).on('videoStop', onStop);
    const commandId = '55555555-5555-4555-8555-555555555555';
    inject({
      source: 'roomkit-player',
      type: 'video:play',
      commandId,
      assetName: 'clip',
      url: 'https://media.example/clip.mp4',
      durationMs: null,
      frame: null,
      params: { overlay: 'chat' },
    });
    inject({ source: 'roomkit-player', type: 'video:stop', commandId });
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ commandId, url: 'https://media.example/clip.mp4' }),
    );
    expect(onStop).toHaveBeenCalledExactlyOnceWith({ commandId });
  });

  it('rewrites a video:play Blob to a same-origin object URL, revoking on stop', () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:site/1');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { helper, inject } = env({ renders: { video: true } });
      const onPlay = vi.fn();
      helper.on('videoPlay', onPlay);
      const commandId = '55555555-5555-4555-8555-555555555555';
      const blob = new Blob(['bytes'], { type: 'video/mp4' });
      inject({
        source: 'roomkit-player',
        type: 'video:play',
        commandId,
        assetName: 'clip',
        url: 'https://media.example/clip.mp4',
        blob,
        durationMs: null,
        frame: null,
        params: {},
      });
      expect(created).toHaveBeenCalledExactlyOnceWith(blob);
      // Sites only ever see `url` — rewritten to the blob URL, blob stripped.
      expect(onPlay).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ commandId, url: 'blob:site/1' }),
      );
      expect(onPlay.mock.calls[0][0]).not.toHaveProperty('blob');
      expect(revoked).not.toHaveBeenCalled();
      inject({ source: 'roomkit-player', type: 'video:stop', commandId });
      expect(revoked).toHaveBeenCalledExactlyOnceWith('blob:site/1');
    } finally {
      created.mockRestore();
      revoked.mockRestore();
    }
  });

  it('revokes an outstanding video object URL when a new play replaces it and on destroy', () => {
    const created = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:site/1')
      .mockReturnValueOnce('blob:site/2');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const { helper, inject } = env({ renders: { video: true } });
      const play = (commandId: string) => ({
        source: 'roomkit-player',
        type: 'video:play',
        commandId,
        assetName: 'clip',
        url: 'https://media.example/clip.mp4',
        blob: new Blob(['bytes'], { type: 'video/mp4' }),
        durationMs: null,
        frame: null,
        params: {},
      });
      inject(play('55555555-5555-4555-8555-555555555555'));
      inject(play('66666666-6666-4666-8666-666666666666'));
      expect(revoked).toHaveBeenCalledExactlyOnceWith('blob:site/1');
      helper.destroy();
      expect(revoked).toHaveBeenCalledTimes(2);
      expect(revoked).toHaveBeenLastCalledWith('blob:site/2');
      expect(created).toHaveBeenCalledTimes(2);
    } finally {
      created.mockRestore();
      revoked.mockRestore();
    }
  });

  it('getRemainingTime posts a schema-valid request and resolves on the reply', async () => {
    const { helper, posted, inject } = env();
    const promise = helper.getRemainingTime({ resync: true });
    const request = HelperToPlayerSchema.parse(posted[1]);
    expect(request).toMatchObject({
      source: 'roomkit-helper',
      type: 'timer:get',
      resync: true,
    });
    const requestId = (request as { requestId: string }).requestId;
    inject({ source: 'roomkit-player', type: 'timer', requestId, remainingMs: 61_500 });
    await expect(promise).resolves.toBe(61_500);
  });

  it('getRemainingTime ignores replies for other requests and times out', async () => {
    vi.useFakeTimers();
    try {
      const { helper, posted, inject } = env();
      const promise = helper.getRemainingTime({ timeoutMs: 1000 });
      expect(HelperToPlayerSchema.parse(posted[1])).toMatchObject({
        type: 'timer:get',
        resync: false,
      });
      inject({
        source: 'roomkit-player',
        type: 'timer',
        requestId: '33333333-3333-4333-8333-333333333333',
        remainingMs: 5,
      });
      vi.advanceTimersByTime(1000);
      await expect(promise).rejects.toThrow('timer request timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks the player-reported session mode, ignoring bogus values', () => {
    const { helper, inject } = env();
    expect(helper.sessionMode).toBe('production');
    inject({ source: 'roomkit-player', type: 'mode', mode: 'test' });
    expect(helper.sessionMode).toBe('test');
    inject({ source: 'roomkit-player', type: 'mode', mode: 'bogus' });
    expect(helper.sessionMode).toBe('test');
    inject({ source: 'roomkit-player', type: 'mode', mode: 'production' });
    expect(helper.sessionMode).toBe('production');
  });

  it('ignores malformed, wrong-source, and unknown messages', () => {
    const { helper, inject } = env();
    const onAny = vi.fn();
    helper.on('message', onAny).on('hint', onAny).on('hintError', onAny);
    inject(null);
    inject('roomkit-player');
    inject({ type: 'message', payload: {} }); // no source
    inject({ source: 'roomkit-helper', type: 'message', payload: {} }); // own source
    inject({ source: 'roomkit-player', type: 'unknown-future-type' });
    inject({ source: 'roomkit-player', type: 'message', payload: 'nope' });
    inject({ source: 'roomkit-player', type: 'hint:show', hint: null });
    expect(onAny).not.toHaveBeenCalled();
  });

  it('off() and destroy() stop dispatch', () => {
    const { helper, inject, listeners } = env();
    const onHint = vi.fn();
    helper.on('hint', onHint);
    helper.off('hint', onHint);
    inject({ source: 'roomkit-player', type: 'hint:show', hint: HINT });
    expect(onHint).not.toHaveBeenCalled();

    helper.destroy();
    expect(listeners.size).toBe(0);
  });
});
