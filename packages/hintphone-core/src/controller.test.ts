import { describe, expect, it } from 'vitest';
import type { HintShow } from '@roomkit/shared';
import { Emitter } from './emitter.js';
import type {
  HintphoneConnectionEvents,
  HintphoneConnectionState,
  HintphoneEventSource,
} from './connection.js';
import { HintphoneController } from './controller.js';
import { HintphoneCounterCore } from './counter.js';

const HINT_ID = '4d3f0f0a-5f9f-4c65-91a4-c9a6cf4f2a11';

class FakeConnection implements HintphoneEventSource {
  state: HintphoneConnectionState = 'connected';
  readonly emitter = new Emitter<HintphoneConnectionEvents>();
  readonly requested: Array<{ hintId: string; step: number }> = [];
  readonly submitted: string[] = [];

  submitHint(code: string): void {
    this.submitted.push(code);
  }
  requestHintStep(hintId: string, step: number): void {
    this.requested.push({ hintId, step });
  }
  on<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }
  off<K extends keyof HintphoneConnectionEvents>(
    event: K,
    listener: (...args: HintphoneConnectionEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  show(partial: Partial<HintShow>): HintShow {
    const hint: HintShow = {
      hintId: HINT_ID,
      code: '1234',
      step: 0,
      stepCount: 2,
      hasAnswer: false,
      isAnswer: false,
      textHtml: '<p>hi</p>',
      imageUrl: null,
      ...partial,
    };
    this.emitter.emit('hint', hint);
    return hint;
  }
}

describe('HintphoneController', () => {
  it('walks steps and reveals the answer as step stepCount', () => {
    const conn = new FakeConnection();
    const ctl = new HintphoneController(conn);

    ctl.submitCode(' 1234 ');
    expect(conn.submitted).toEqual(['1234']);
    expect(ctl.snapshot.pending).toBe(true);

    conn.show({ step: 0, stepCount: 2, hasAnswer: true });
    expect(ctl.snapshot.pending).toBe(false);
    expect(ctl.snapshot.hasPrev).toBe(false);
    expect(ctl.snapshot.hasNext).toBe(true);
    expect(ctl.snapshot.nextIsAnswer).toBe(false);

    ctl.next();
    expect(conn.requested).toEqual([{ hintId: HINT_ID, step: 1 }]);
    conn.show({ step: 1, stepCount: 2, hasAnswer: true });
    expect(ctl.snapshot.nextIsAnswer).toBe(true);

    ctl.next();
    expect(conn.requested).toEqual([
      { hintId: HINT_ID, step: 1 },
      { hintId: HINT_ID, step: 2 },
    ]);
    conn.show({ step: 2, stepCount: 2, hasAnswer: true, isAnswer: true });
    expect(ctl.snapshot.hasNext).toBe(false);
    expect(ctl.snapshot.hasPrev).toBe(true);

    // prev from the answer goes back to the last regular step
    ctl.prev();
    expect(conn.requested.at(-1)).toEqual({ hintId: HINT_ID, step: 1 });
    ctl.destroy();
  });

  it('has no next on the last step without an answer', () => {
    const conn = new FakeConnection();
    const ctl = new HintphoneController(conn);
    conn.show({ step: 1, stepCount: 2, hasAnswer: false });
    expect(ctl.snapshot.hasNext).toBe(false);
    ctl.next();
    expect(conn.requested).toEqual([]);
    ctl.destroy();
  });

  it('clears pending and stores the error on hintError', () => {
    const conn = new FakeConnection();
    const ctl = new HintphoneController(conn);
    ctl.submitCode('9999');
    conn.emitter.emit('hintError', { reason: 'unknown_code', code: '9999' });
    expect(ctl.snapshot.pending).toBe(false);
    expect(ctl.snapshot.error?.reason).toBe('unknown_code');
    ctl.destroy();
  });
});

describe('HintphoneCounterCore', () => {
  it('counts unique hints, steps, answers, and wrong codes', () => {
    const conn = new FakeConnection();
    const counter = new HintphoneCounterCore(conn);

    conn.show({ step: 0 });
    conn.show({ step: 0 }); // repeat: totalShows only
    conn.show({ step: 1 });
    conn.show({ step: 2, hasAnswer: true, isAnswer: true });
    conn.emitter.emit('hintError', { reason: 'unknown_code', code: '0000' });
    conn.emitter.emit('hintError', { reason: 'session_not_running' });

    expect(counter.stats).toEqual({
      hintsUsed: 1,
      stepsViewed: 3,
      totalShows: 4,
      answersOpened: 1,
      wrongCodes: 1,
    });

    counter.reset();
    expect(counter.stats.hintsUsed).toBe(0);
    expect(counter.stats.totalShows).toBe(0);
    counter.destroy();
  });
});
