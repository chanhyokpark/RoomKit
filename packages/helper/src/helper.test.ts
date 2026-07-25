import { describe, expect, it, vi } from 'vitest';
import {
  HelperToPlayerSchema,
  type HintError,
  type HintShow,
  type PlayerMessage,
} from '@roomkit/shared';
import { RoomKitHelper, type RoomKitHelperOptions } from './helper.js';

type Listener = (event: { data: unknown }) => void;

/** Fake iframe environment: capture outbound posts, allow injecting inbound. */
function env(options: Pick<RoomKitHelperOptions, 'renders'> = {}) {
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
    });
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
