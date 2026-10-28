import type { EvalOutcome } from "@roomkit/shared";

class EvaluationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Executes in the site's realm. This is trusted test code, not a JS sandbox. */
export async function evaluateScript(
  code: string,
  roomkit: unknown,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<EvalOutcome> {
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () =>
    controller.abort(
      new EvaluationError("page_gone", "The website or test session went away"),
    );
  parentSignal.addEventListener("abort", abort, { once: true });
  if (parentSignal.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new EvaluationError(
          "timeout",
          "Script timed out; it may still be running. Reload the website before another evaluation.",
        ),
      ),
    timeoutMs,
  );
  let stopRace: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason);
    stopRace = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const delay = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const onAbort = () => {
        clearTimeout(id);
        reject(signal.reason);
      };
      const id = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  const waitFor = async (
    predicate: () => unknown,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ) => {
    const deadline =
      Date.now() + Math.min(options.timeoutMs ?? timeoutMs, timeoutMs);
    while (true) {
      signal.throwIfAborted();
      const value = await predicate();
      if (value) return value;
      if (Date.now() >= deadline)
        throw new EvaluationError(
          "condition_timeout",
          "waitFor condition timed out",
        );
      await delay(Math.max(1, Math.min(options.intervalMs ?? 25, 1000)));
    }
  };
  try {
    const task = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const AsyncFunction = Object.getPrototypeOf(async function () {})
        .constructor as new (
        ...args: string[]
      ) => (...args: unknown[]) => Promise<unknown>;
      const run = new AsyncFunction(
        "roomkit",
        "waitFor",
        "signal",
        `"use strict";\n${code}\n//# sourceURL=roomkit-device-eval.js`,
      );
      const value = await run(roomkit, waitFor, signal);
      // Undefined at the top level is a void return. Reject lossy/non-JSON values.
      const json = JSON.stringify(
        value === undefined ? null : value,
        (_key, item: unknown) => {
          if (
            ["undefined", "function", "symbol", "bigint"].includes(
              typeof item,
            ) ||
            (typeof item === "number" && !Number.isFinite(item)) ||
            (typeof Node !== "undefined" && item instanceof Node)
          ) {
            throw new EvaluationError(
              "invalid_result",
              "Return a JSON value, not DOM nodes, functions, BigInt, undefined properties or non-finite numbers",
            );
          }
          return item;
        },
      );
      if (json.length > 32_000)
        throw new EvaluationError(
          "result_too_large",
          "Result exceeds 32000 characters",
        );
      return JSON.parse(json);
    });
    return { ok: true, value: await Promise.race([task, aborted]) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof EvaluationError ? error.code : "script_error",
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          4000,
        ),
        ...(error instanceof Error && error.stack
          ? { stack: error.stack.slice(0, 8000) }
          : {}),
      },
    };
  } finally {
    clearTimeout(timer);
    stopRace?.();
    parentSignal.removeEventListener("abort", abort);
    controller.abort(new EvaluationError("finished", "Evaluation finished"));
  }
}
