import type { HintError, HintShow } from '@roomkit/shared';
import type {
  HintphoneConnectionState,
  HintphoneEventSource,
} from './connection.js';

/** A request without a reply stops blocking the UI after this long. */
const PENDING_TIMEOUT_MS = 10_000;

/**
 * Immutable view of the hintphone state. A new object is produced on every
 * change (the previous one is never mutated), so framework bindings can use
 * reference equality (React useSyncExternalStore, Svelte $state).
 */
export interface HintphoneSnapshot {
  connectionState: HintphoneConnectionState;
  /** The hint step (or answer) currently on screen; null = idle. */
  hint: HintShow | null;
  /** Last error; cleared by the next successful show or submit. */
  error: HintError | null;
  /** A submit/step request is in flight. */
  pending: boolean;
  /** prev() will do something. */
  hasPrev: boolean;
  /** next() will do something (includes revealing the answer). */
  hasNext: boolean;
  /** next() reveals the explicit answer rather than another step. */
  nextIsAnswer: boolean;
}

/** Snapshot for bindings that haven't attached to a controller yet. */
export const IDLE_HINTPHONE_SNAPSHOT: HintphoneSnapshot = {
  connectionState: 'connecting',
  hint: null,
  error: null,
  pending: false,
  hasPrev: false,
  hasNext: false,
  nextIsAnswer: false,
};

/**
 * Hint navigation state machine over a {@link HintphoneConnection}:
 * submit a code, walk steps with prev/next, reveal the explicit answer.
 * Subscribe for change notifications; read {@link snapshot} for state.
 */
export class HintphoneController {
  private readonly subscribers = new Set<() => void>();
  private current: HintphoneSnapshot;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onHint = (hint: HintShow): void => {
    this.update({ hint, error: null, pending: false });
  };
  private readonly onHintError = (error: HintError): void => {
    this.update({ error, pending: false });
  };
  private readonly onState = (): void => {
    this.update({});
  };

  constructor(readonly connection: HintphoneEventSource) {
    this.current = this.build({
      connectionState: connection.state,
      hint: null,
      error: null,
      pending: false,
      hasPrev: false,
      hasNext: false,
      nextIsAnswer: false,
    });
    connection.on('hint', this.onHint);
    connection.on('hintError', this.onHintError);
    connection.on('state', this.onState);
  }

  get snapshot(): HintphoneSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Submit an entered hint code. */
  submitCode(code: string): void {
    const trimmed = code.trim();
    if (!trimmed) return;
    this.update({ error: null, pending: true });
    this.connection.submitHint(trimmed);
  }

  /** Show the previous step (from the answer: back to the last step). */
  prev(): void {
    const { hint } = this.current;
    if (!hint) return;
    const target = hint.isAnswer ? hint.stepCount - 1 : hint.step - 1;
    if (target < 0) return;
    this.request(hint.hintId, target);
  }

  /** Show the next step; on the last step this reveals the answer. */
  next(): void {
    const { hint } = this.current;
    if (!hint || hint.isAnswer) return;
    if (hint.step < hint.stepCount - 1) {
      this.request(hint.hintId, hint.step + 1);
    } else if (hint.hasAnswer) {
      this.request(hint.hintId, hint.stepCount);
    }
  }

  /** Reveal the explicit answer directly (no-op without one). */
  showAnswer(): void {
    const { hint } = this.current;
    if (!hint || !hint.hasAnswer || hint.isAnswer) return;
    this.request(hint.hintId, hint.stepCount);
  }

  /** Clear the current hint and error (back to the idle input screen). */
  dismiss(): void {
    this.update({ hint: null, error: null, pending: false });
  }

  destroy(): void {
    this.clearPendingTimer();
    this.connection.off('hint', this.onHint);
    this.connection.off('hintError', this.onHintError);
    this.connection.off('state', this.onState);
    this.subscribers.clear();
  }

  private request(hintId: string, step: number): void {
    this.update({ error: null, pending: true });
    this.connection.requestHintStep(hintId, step);
  }

  private update(patch: Partial<HintphoneSnapshot>): void {
    this.clearPendingTimer();
    this.current = this.build({
      ...this.current,
      connectionState: this.connection.state,
      ...patch,
    });
    if (this.current.pending) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.update({ pending: false });
      }, PENDING_TIMEOUT_MS);
    }
    for (const listener of [...this.subscribers]) listener();
  }

  /** Recompute the derived navigation flags from hint/step. */
  private build(base: HintphoneSnapshot): HintphoneSnapshot {
    const hint = base.hint;
    return {
      ...base,
      hasPrev: hint !== null && (hint.isAnswer || hint.step > 0),
      hasNext:
        hint !== null &&
        !hint.isAnswer &&
        (hint.step < hint.stepCount - 1 || hint.hasAnswer),
      nextIsAnswer:
        hint !== null &&
        !hint.isAnswer &&
        hint.step >= hint.stepCount - 1 &&
        hint.hasAnswer,
    };
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
