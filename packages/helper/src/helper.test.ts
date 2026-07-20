import { describe, expect, it, vi } from 'vitest';
import {
  HelperToPlayerSchema,
  type HintError,
  type HintShow,
  type PlayerMessage,
} from '@roomkit/shared';
import { RoomKitHelper } from './helper.js';

type Listener = (event: { data: unknown }) => void;

/** Fake iframe environment: capture outbound posts, allow injecting inbound. */
function env() {
  const posted: unknown[] = [];
  const listeners = new Set<Listener>();
  const helper = new RoomKitHelper({
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
  it('posts hello on construction, with the helper source', () => {
    const { posted } = env();
    expect(posted).toEqual([{ source: 'roomkit-helper', type: 'hello' }]);
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
