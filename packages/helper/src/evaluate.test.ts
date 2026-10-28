import { describe, expect, it, vi } from "vitest";
import { EvalOutcomeSchema } from "@roomkit/shared";
import { evaluateScript } from "./evaluate.js";

const run = (code: string, roomkit: unknown = {}) =>
  evaluateScript(code, roomkit, 500, new AbortController().signal);

describe("test JS execution", () => {
  it("executes async function bodies with the site helper and JSON return values", async () => {
    const result = await run(
      "await Promise.resolve(); return { answer: await roomkit.answer() };",
      { answer: async () => 42 },
    );
    expect(EvalOutcomeSchema.parse(result)).toEqual({
      ok: true,
      value: { answer: 42 },
    });
    expect(await run("return;")).toEqual({ ok: true, value: null });
  });

  it("allows inspecting and manipulating the current document", async () => {
    const button = {
      textContent: "before",
      click() {
        this.textContent = "after";
      },
    };
    vi.stubGlobal("document", { querySelector: () => button });
    try {
      expect(
        await run(
          'const button = document.querySelector("button"); button.click(); return button.textContent;',
        ),
      ).toEqual({ ok: true, value: "after" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waitFor polls until a condition is met", async () => {
    let calls = 0;
    expect(
      await run(
        "return await waitFor(() => roomkit.ready(), { intervalMs: 1 });",
        { ready: () => ++calls === 3 && "ready" },
      ),
    ).toEqual({ ok: true, value: "ready" });
    expect(calls).toBe(3);
  });

  it.each([
    'throw new Error("boom")',
    'return await Promise.reject(new Error("boom"))',
    "return (",
  ])("reports runtime and syntax errors: %s", async (code) => {
    const result = await run(code);
    expect(EvalOutcomeSchema.parse(result)).toMatchObject({
      ok: false,
      error: { code: "script_error", stack: expect.any(String) },
    });
  });

  it.each([
    "return 1n",
    "return () => 1",
    "return { missing: undefined }",
    "return NaN",
    "const a = {}; a.a = a; return a;",
  ])("rejects non-JSON results: %s", async (code) => {
    expect(await run(code)).toMatchObject({ ok: false });
  });

  it("rejects oversized results before posting them", async () => {
    expect(await run('return "x".repeat(32001);')).toMatchObject({
      ok: false,
      error: { code: "result_too_large" },
    });
  });

  it("bounds async execution and aborts cooperative waits", async () => {
    const result = await evaluateScript(
      "await new Promise(() => {});",
      {},
      100,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(
      await run("await waitFor(() => false, { timeoutMs: 1, intervalMs: 1 });"),
    ).toMatchObject({ ok: false, error: { code: "condition_timeout" } });
  });

  it("cancels on document destruction without executing pre-aborted code", async () => {
    const controller = new AbortController();
    const touch = vi.fn();
    controller.abort();
    expect(
      await evaluateScript(
        "roomkit.touch()",
        { touch },
        500,
        controller.signal,
      ),
    ).toMatchObject({ ok: false, error: { code: "page_gone" } });
    expect(touch).not.toHaveBeenCalled();
  });
});
