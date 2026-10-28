import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DeviceEvalInputSchema,
  DeviceEvalResultSchema,
  type DeviceEvalRequest,
} from "@roomkit/shared";
import { WebsiteEvaluator } from "../../../player/src/lib/bridge/website-evaluator.js";
import { saveEvaluationScreenshot } from "./device-eval.js";
import { createProgram } from "../program.js";
import { errorToJson } from "../ui/output.js";
import { ToolError } from "../core/session.js";

const request = (screenshot = true): DeviceEvalRequest => ({
  ...DeviceEvalInputSchema.parse({ code: "return 42;", screenshot }),
  requestId: crypto.randomUUID(),
});
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=";
const shot = { image, width: 1, height: 1 };

describe("website evaluation and CLI image contract", () => {
  it("waits for the script and painting, captures a fresh image, and writes the matching bytes", async () => {
    const calls: string[] = [];
    const evaluator = new WebsiteEvaluator({
      isTest: () => true,
      post: () => {
        calls.push("script");
      },
      afterPaint: async () => {
        calls.push("paint");
      },
      capture: async () => {
        calls.push("capture");
        return shot;
      },
    });
    evaluator.hello(true);
    const req = request();
    const result = evaluator.run(req);
    assert.deepEqual(calls, ["script"]);
    await evaluator.receive(crypto.randomUUID(), {
      ok: true,
      value: "unrelated",
    });
    assert.deepEqual(calls, ["script"]);
    await evaluator.receive(req.requestId, { ok: true, value: 42 });
    const response = DeviceEvalResultSchema.parse(await result);
    assert.deepEqual(calls, ["script", "paint", "capture"]);
    assert.deepEqual(response.result, { ok: true, value: 42 });
    const dir = mkdtempSync(join(tmpdir(), "roomkit-eval-"));
    try {
      const path = join(dir, "result.png");
      const metadata = saveEvaluationScreenshot(path, response.screenshot!);
      assert.equal(metadata.mimeType, "image/png");
      assert.equal(readFileSync(path).toString("base64"), image.split(",")[1]);
      assert.throws(
        () => saveEvaluationScreenshot(path, response.screenshot!),
        /EEXIST/,
      );
      assert.throws(
        () =>
          saveEvaluationScreenshot(
            join(dir, "wrong.jpg"),
            response.screenshot!,
          ),
        /format/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves a successful return value when capture fails", async () => {
    const evaluator = new WebsiteEvaluator({
      isTest: () => true,
      post() {},
      afterPaint: async () => {},
      capture: async () => null,
    });
    evaluator.hello(true);
    const req = request();
    const done = evaluator.run(req);
    await evaluator.receive(req.requestId, { ok: true, value: 42 });
    const response = await done;
    assert.deepEqual(response.result, { ok: true, value: 42 });
    assert.equal(response.screenshotError?.code, "capture_failed");
  });

  it("invalidates navigation during capture and rejects late results from the old document", async () => {
    let finishCapture!: (value: typeof shot) => void;
    const evaluator = new WebsiteEvaluator({
      isTest: () => true,
      post() {},
      afterPaint: async () => {},
      capture: () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    });
    evaluator.hello(true);
    const req = request();
    const done = evaluator.run(req);
    const receiving = evaluator.receive(req.requestId, { ok: true, value: 42 });
    await Promise.resolve();
    evaluator.hello(true);
    finishCapture(shot);
    await receiving;
    const response = await done;
    assert.equal(response.result.ok, false);
    assert.equal(response.screenshot, undefined);
    if (!response.result.ok)
      assert.equal(response.result.error.code, "page_gone");
  });

  it("refuses production, old helpers and overlapping requests without delivering code", async () => {
    let posts = 0;
    let isTest = false;
    const evaluator = new WebsiteEvaluator({
      isTest: () => isTest,
      post() {
        posts++;
      },
      afterPaint: async () => {},
      capture: async () => shot,
    });
    evaluator.hello(true);
    assert.equal((await evaluator.run(request())).result.ok, false);
    isTest = true;
    evaluator.hello(false);
    assert.equal((await evaluator.run(request())).result.ok, false);
    assert.equal(posts, 0);
    evaluator.hello(true);
    const req = request(false);
    const pending = evaluator.run(req);
    assert.equal((await evaluator.run(request())).result.ok, false);
    assert.equal(posts, 1);
    await evaluator.receive(req.requestId, {
      ok: false,
      error: { code: "script_error", message: "boom" },
    });
    assert.equal((await pending).screenshot, undefined);
  });

  it("validates CLI input before connecting to a server and preserves structured error details", async () => {
    for (const args of [
      [],
      ["--script", "return 1", "--file", "x.js"],
      ["--script", "return 1", "--screenshot", "x.gif"],
    ]) {
      const { program } = createProgram();
      await assert.rejects(
        program.parseAsync([
          "node",
          "rk",
          "--no-update-check",
          "device",
          "eval",
          "screen",
          "--session",
          crypto.randomUUID(),
          ...args,
        ]),
        ToolError,
      );
    }
    const details = {
      requestId: crypto.randomUUID(),
      result: {
        ok: false,
        error: { code: "script_error", message: "boom", stack: "site.js:1" },
      },
    };
    assert.deepEqual(
      errorToJson(new ToolError("boom", "script_error", details)).error.details,
      details,
    );
  });
});
