import * as vm from 'node:vm';
import type { JsonValue } from '@roomkit/shared';

export interface EvalContext {
  /** Session variables — mutations are visible to parallel runs immediately. */
  vars: Record<string, JsonValue>;
  /** Current phase name (null when the session has no phase). */
  phase: string | null;
  /** Fires an event through the same admission path as a device trigger. */
  trigger: (name: string) => void;
  /** Writes to the session log. */
  log: (msg: string) => void;
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
