import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DeviceWindowRequestSchema,
  DeviceWindowResultSchema,
  type DeviceWindowRequest,
  type SessionDevicesResponse,
} from "@roomkit/shared";
import { answerWindowRequest } from "../../../player/src/lib/window-rpc.js";
import { waitForDevicesReady } from "../core/ops/devices.js";
import type { OpsContext } from "../core/context.js";
import { ToolError } from "../core/session.js";
import { createProgram } from "../program.js";
import { finishWithScreenshot, prepareScreenshotPath } from "./device-eval.js";

const request = (
  overrides: Partial<Omit<DeviceWindowRequest, "requestId">> = {},
): DeviceWindowRequest =>
  DeviceWindowRequestSchema.parse({
    requestId: crypto.randomUUID(),
    ...overrides,
  });
const shot = {
  image:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=",
  width: 1,
  height: 1,
};
const state = { visible: true, focused: true, platform: "macos" };

describe("player window RPC and CLI screenshot/reload/status plumbing", () => {
  it("focuses before reading the state, then paints and captures", async () => {
    const calls: string[] = [];
    const result = await answerWindowRequest(
      request({ focus: true, screenshot: true, screenshotFormat: "png" }),
      {
        isTest: () => true,
        focus: async () => {
          calls.push("focus");
        },
        state: async () => {
          calls.push("state");
          return state;
        },
        afterPaint: async () => {
          calls.push("paint");
        },
        capture: async (format) => {
          calls.push(`capture:${format}`);
          return shot;
        },
      },
    );
    assert.deepEqual(calls, ["focus", "state", "paint", "capture:png"]);
    const parsed = DeviceWindowResultSchema.parse(result);
    assert.deepEqual(parsed.result, { ok: true, value: state });
    assert.equal(parsed.screenshot?.width, 1);
  });

  it("keeps the window state when capture fails or misses the deadline, and refuses outside test sessions", async () => {
    const io = {
      isTest: () => true,
      focus: async () => {},
      state: async () => state,
      afterPaint: async () => {},
      capture: async () => null,
    };
    const failed = await answerWindowRequest(request({ screenshot: true }), io);
    assert.equal(failed.result.ok, true);
    assert.equal(failed.screenshotError?.code, "capture_failed");

    const slow = await answerWindowRequest(
      request({ screenshot: true, timeoutMs: 100 }),
      { ...io, capture: () => new Promise(() => {}) },
    );
    assert.equal(slow.result.ok, true);
    assert.match(slow.screenshotError?.message ?? "", /deadline/);

    const hidden = await answerWindowRequest(request({ focus: true }), {
      ...io,
      focus: async () => {
        throw new Error("still hidden");
      },
    });
    assert.equal(hidden.result.ok, false);
    if (!hidden.result.ok) assert.equal(hidden.result.error.code, "focus_failed");

    const production = await answerWindowRequest(request(), { ...io, isTest: () => false });
    assert.equal(production.result.ok, false);
  });

  it("refuses existing screenshot targets unless --overwrite and surfaces errors with details", () => {
    const dir = mkdtempSync(join(tmpdir(), "roomkit-window-"));
    try {
      const existing = join(dir, "taken.png");
      writeFileSync(existing, "x");
      assert.throws(() => prepareScreenshotPath(existing, false), /already exists/);
      assert.equal(prepareScreenshotPath(existing, true).format, "png");
      assert.equal(prepareScreenshotPath(join(dir, "new.jpg"), false).format, "jpeg");
      assert.throws(() => prepareScreenshotPath(join(dir, "x.gif"), false), ToolError);

      const requestId = crypto.randomUUID();
      const saved = finishWithScreenshot(
        {
          requestId,
          result: { ok: true, value: state },
          screenshot: { ...shot, capturedAt: 1 },
        },
        { path: existing, overwrite: true },
      );
      assert.equal(saved.value.platform, "macos");
      assert.equal(saved.screenshot?.path, existing);
      assert.throws(
        () =>
          finishWithScreenshot(
            { requestId, result: { ok: true, value: state }, screenshotError: { code: "capture_failed", message: "no" } },
            undefined,
          ),
        (err: unknown) => err instanceof ToolError && err.code === "capture_failed",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("polls device status until the targeted devices are ready", async () => {
    const snapshots: SessionDevicesResponse["devices"][] = [
      [{ ready: false }, { ready: true }],
      [{ ready: true }, { ready: true }],
    ].map((devices) =>
      devices.map((d, i) => ({
        deviceId: `00000000-0000-4000-8000-00000000000${i}`,
        deviceName: `d${i}`,
        displayName: `d${i}`,
        code: null,
        online: true,
        windows: 1,
        website: null,
        state: null,
        screenshotAt: null,
        ...d,
      })),
    );
    let calls = 0;
    const ctx = {
      api: {
        api: async () => ({
          sessionId: "00000000-0000-4000-8000-0000000000aa",
          mode: "test",
          state: "running",
          devices: snapshots[Math.min(calls++, snapshots.length - 1)],
        }),
      },
    } as unknown as OpsContext;
    const sessionId = "00000000-0000-4000-8000-0000000000aa";
    const all = await waitForDevicesReady(ctx, sessionId, { timeoutMs: 2000, intervalMs: 5 });
    assert.equal(all.ready, true);
    assert.equal(calls, 2);
    calls = 0;
    const one = await waitForDevicesReady(ctx, sessionId, {
      deviceId: "00000000-0000-4000-8000-000000000001",
      timeoutMs: 2000,
      intervalMs: 5,
    });
    assert.equal(one.ready, true);
    assert.equal(calls, 1);
    calls = 0;
    const never = await waitForDevicesReady(ctx, sessionId, {
      deviceId: "00000000-0000-4000-8000-000000000009",
      timeoutMs: 20,
      intervalMs: 5,
    });
    assert.equal(never.ready, false);
  });

  it("validates screenshot paths before any request is made", async () => {
    const { program } = createProgram();
    await assert.rejects(
      program.parseAsync([
        "node", "rk", "--no-update-check", "device", "screenshot", "screen", "shot.gif",
        "--session", crypto.randomUUID(),
      ]),
      ToolError,
    );
  });
});
