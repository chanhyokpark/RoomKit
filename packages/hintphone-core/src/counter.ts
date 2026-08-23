import type { HintError, HintShow } from '@roomkit/shared';
import type { HintphoneEventSource } from './connection.js';

/**
 * Immutable stats snapshot — a new object per change, so bindings can use
 * reference equality.
 */
export interface HintCounterStats {
  /** Distinct hints shown (code entry or admin push). */
  hintsUsed: number;
  /** Distinct (hint, step) pairs shown; the answer counts as a step. */
  stepsViewed: number;
  /** Total hint shows, repeats included. */
  totalShows: number;
  /** Distinct hints whose explicit answer was revealed. */
  answersOpened: number;
  /** Rejected code entries (unknown_code errors). */
  wrongCodes: number;
}

export const EMPTY_HINT_COUNTER_STATS: HintCounterStats = {
  hintsUsed: 0,
  stepsViewed: 0,
  totalShows: 0,
  answersOpened: 0,
  wrongCodes: 0,
};
const EMPTY = EMPTY_HINT_COUNTER_STATS;

/**
 * Counts hint usage on a {@link HintphoneConnection}. Framework bindings
 * (React `useHintCounter`, Svelte `HintCounter`) wrap this class.
 */
export class HintphoneCounterCore {
  private readonly subscribers = new Set<() => void>();
  private readonly seenHints = new Set<string>();
  private readonly seenSteps = new Set<string>();
  private readonly seenAnswers = new Set<string>();
  private current: HintCounterStats = EMPTY;

  private readonly onHint = (hint: HintShow): void => {
    this.seenHints.add(hint.hintId);
    this.seenSteps.add(`${hint.hintId}:${hint.step}`);
    if (hint.isAnswer) this.seenAnswers.add(hint.hintId);
    this.publish({ totalShows: this.current.totalShows + 1 });
  };
  private readonly onHintError = (error: HintError): void => {
    if (error.reason !== 'unknown_code') return;
    this.publish({ wrongCodes: this.current.wrongCodes + 1 });
  };

  constructor(private readonly connection: HintphoneEventSource) {
    connection.on('hint', this.onHint);
    connection.on('hintError', this.onHintError);
  }

  get stats(): HintCounterStats {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  reset(): void {
    this.seenHints.clear();
    this.seenSteps.clear();
    this.seenAnswers.clear();
    this.current = EMPTY;
    for (const listener of [...this.subscribers]) listener();
  }

  destroy(): void {
    this.connection.off('hint', this.onHint);
    this.connection.off('hintError', this.onHintError);
    this.subscribers.clear();
  }

  private publish(patch: Partial<HintCounterStats>): void {
    this.current = {
      ...this.current,
      ...patch,
      hintsUsed: this.seenHints.size,
      stepsViewed: this.seenSteps.size,
      answersOpened: this.seenAnswers.size,
    };
    for (const listener of [...this.subscribers]) listener();
  }
}
