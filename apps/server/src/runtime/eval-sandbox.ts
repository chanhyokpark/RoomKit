import * as vm from 'node:vm';
import type { JsonValue } from '@roomkit/shared';

/**
 * The API exposed to eval'd scripts. The script runs synchronously in the vm,
 * so the engine-action functions (switchPhase/notify/adjustTimer/endTheme)
 * only queue: they validate their arguments immediately (throwing stops the
 * sequence, fail-safe) and run after the script returns, in call order.
 */
export interface EvalContext {
  /** Session variables — mutations are visible to parallel runs immediately. */
  vars: Record<string, JsonValue>;
  /**
   * Payload of the device trigger that started this run (null when there is
   * none — manual/system triggers, or the device sent no payload). A clone:
   * mutations don't leak into other commands of the run.
   */
  payload: JsonValue | null;
  /** Current phase name (null when the session has no phase). */
  phase: string | null;
  /** Fires an event through the same admission path as a device trigger. */
  trigger: (name: string) => void;
  /** Writes to the session log. */
  log: (msg: string) => void;
  /** Queued: switches to the phase with this name (warn-logged if unknown). */
  switchPhase: (name: string) => void;
  /** Queued: shows a toast on the operation screen. */
  notify: (message: string) => void;
  /** Queued: shifts the timer by deltaMs, or pauses/resumes it. */
  adjustTimer: (arg: number | 'pause' | 'resume') => void;
  /** Queued: ends the session; remaining queued actions are skipped. */
  endTheme: (verdict: 'success' | 'fail') => void;
}

export const EVAL_TIMEOUT_MS = 1000;

/**
 * Runs creator-authored code in a node:vm context exposing `ctx`. The timeout
 * is a hang guard, not a security boundary — eval code is trusted admin input
 * (see SPEC "Security Note").
 *
 * A `false` return value means "stop the sequence" (caller's contract).
 */
export function runEval(code: string, ctx: EvalContext): unknown {
  const context = vm.createContext({ ctx });
  const script = new vm.Script(code, { filename: 'sequence-eval.js' });
  return script.runInContext(context, { timeout: EVAL_TIMEOUT_MS });
}
