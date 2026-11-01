import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Command } from "commander";
import type { DeviceLogLine } from "@roomkit/shared";
import type { OpsContext } from "../core/context.js";
import { getDeviceLogs, resolveSessionDevice } from "../core/ops/devices.js";
import { controlSession, skipSessionRun } from "../core/ops/sessions.js";
import { ToolError } from "../core/session.js";
import { createProgram } from "../program.js";
import { filterDeviceLogLines, formatDeviceLogLine, parseLogLevel } from "./device-test.js";

const SESSION_ID = "00000000-0000-4000-8000-0000000000aa";
const THEME_ID = "00000000-0000-4000-8000-0000000000bb";
const DEVICE_ID = "00000000-0000-4000-8000-0000000000cc";
const RUN_ID = "00000000-0000-4000-8000-0000000000dd";
const EVENT_ID = "00000000-0000-4000-8000-0000000000ee";

/** Runs `rk ...` and expects a usage ToolError before any network request. */
async function rejectsWithUsage(args: string[]): Promise<void> {
  const { program } = createProgram();
  await assert.rejects(
    program.parseAsync(["node", "rk", "--no-update-check", ...args]),
    (err: unknown) => err instanceof ToolError && err.code === "usage",
  );
}

function find(root: Command, path: string): Command | undefined {
  let cmd: Command | undefined = root;
  for (const part of path.split(" ")) cmd = cmd?.commands.find((c) => c.name() === part);
  return cmd;
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  themeId: THEME_ID,
  mode: "production",
  phaseId: null,
  state: "running",
  verdict: null,
  vars: {},
  startedAt: new Date(0).toISOString(),
  endedAt: null,
  timerEndsAt: null,
  timerRemainingMs: null,
  ...overrides,
});

/** Fake API: answers by path, records every call, and applies the caller's schema. */
function fakeContext(routes: Record<string, unknown>) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const ctx = {
    api: {
      api: async (path: string, opts: { method?: string; body?: unknown; schema?: { parse(v: unknown): unknown } } = {}) => {
        calls.push({ path, method: opts.method ?? "GET", ...(opts.body !== undefined && { body: opts.body }) });
        if (!(path in routes)) throw new Error(`unexpected request ${path}`);
        const value = routes[path];
        return opts.schema ? opts.schema.parse(value) : value;
      },
    },
  } as unknown as OpsContext;
  return { ctx, calls };
}

const line = (seq: number, level: DeviceLogLine["level"], message = `line ${seq}`): DeviceLogLine => ({
  seq,
  at: 1_700_000_000_000 + seq,
  level,
  message,
});

describe("session trigger/skip and device logs", () => {
  it("registers session skip and device logs", () => {
    const { program } = createProgram();
    for (const path of ["session skip", "session trigger", "device logs", "device eval", "device status"]) {
      assert.ok(find(program, path), `missing rk ${path}`);
    }
  });

  it("validates session trigger arguments before any request", async () => {
    await rejectsWithUsage(["session", "trigger", SESSION_ID]);
    await rejectsWithUsage(["session", "trigger", SESSION_ID, "open-door", "--name", "button:press"]);
    await rejectsWithUsage(["session", "trigger", SESSION_ID, "--name", "button:press", "--payload", "{bad"]);
  });

  it("validates device logs options before any request", async () => {
    await rejectsWithUsage(["device", "logs", "screen", "--session", SESSION_ID, "--level", "bogus"]);
    await rejectsWithUsage(["device", "logs", "screen", "--session", SESSION_ID, "--tail", "-1"]);
    await rejectsWithUsage(["device", "logs", "screen", "--session", SESSION_ID, "--after", "x"]);
    await rejectsWithUsage(["device", "logs", "screen", "--session", SESSION_ID, "--follow", "--interval", "10"]);
    assert.equal(parseLogLevel("warn"), "warn");
  });

  it("filters device log lines by seq and minimum level, then tails", () => {
    const lines = [line(0, "debug"), line(1, "info"), line(2, "warn"), line(3, "error"), line(4, "info")];
    assert.deepEqual(filterDeviceLogLines(lines, {}).map((l) => l.seq), [0, 1, 2, 3, 4]);
    assert.deepEqual(filterDeviceLogLines(lines, { afterSeq: 2 }).map((l) => l.seq), [3, 4]);
    assert.deepEqual(filterDeviceLogLines(lines, { minLevel: "warn" }).map((l) => l.seq), [2, 3]);
    assert.deepEqual(filterDeviceLogLines(lines, { minLevel: "info", tail: 2 }).map((l) => l.seq), [3, 4]);
    assert.deepEqual(filterDeviceLogLines(lines, { tail: 0 }), []);
    const site = formatDeviceLogLine(line(7, "error", "site: TypeError: x is undefined"));
    assert.match(site, /site:/);
    assert.match(site, /TypeError: x is undefined/);
  });

  it("refuses only ended sessions for device tools (production is allowed)", async () => {
    const live = fakeContext({ [`/sessions/${SESSION_ID}`]: session(), [`/themes/${THEME_ID}/assets`]: [] });
    const resolved = await resolveSessionDevice(live.ctx, SESSION_ID, DEVICE_ID, "Reading device logs");
    assert.equal(resolved.deviceId, DEVICE_ID);

    const ended = fakeContext({ [`/sessions/${SESSION_ID}`]: session({ mode: "test", state: "ended" }) });
    await assert.rejects(
      resolveSessionDevice(ended.ctx, SESSION_ID, DEVICE_ID, "JS evaluation"),
      (err: unknown) => err instanceof ToolError && err.code === "not_live",
    );

    const logs = fakeContext({
      [`/sessions/${SESSION_ID}/devices/${DEVICE_ID}/logs`]: { sessionId: SESSION_ID, deviceId: DEVICE_ID, lines: [line(0, "info")] },
    });
    assert.equal((await getDeviceLogs(logs.ctx, SESSION_ID, DEVICE_ID)).lines.length, 1);
  });

  it("posts a named trigger with payload and force without resolving an event, and returns the run list", async () => {
    const reply = {
      trigger: "button:press",
      events: [
        { eventId: EVENT_ID, eventName: "Open door", started: true, runId: RUN_ID },
        { eventId: EVENT_ID, eventName: "Alarm", started: false, reason: "already ran (once)" },
      ],
    };
    const { ctx, calls } = fakeContext({ [`/sessions/${SESSION_ID}/trigger`]: reply });
    const result = await controlSession(ctx, SESSION_ID, {
      type: "trigger_event",
      trigger: "button:press",
      payload: { answer: "1234" },
      force: true,
    });
    assert.deepEqual(result, reply);
    assert.deepEqual(calls, [
      { path: `/sessions/${SESSION_ID}/trigger`, method: "POST", body: { trigger: "button:press", payload: { answer: "1234" }, force: true } },
    ]);

    await assert.rejects(
      controlSession(ctx, SESSION_ID, { type: "trigger_event" }),
      (err: unknown) => err instanceof ToolError && err.code === "usage",
    );
  });

  it("skips the current entry of a run", async () => {
    const { ctx, calls } = fakeContext({ [`/sessions/${SESSION_ID}/runs/${RUN_ID}/skip`]: null });
    assert.deepEqual(await skipSessionRun(ctx, SESSION_ID, RUN_ID), { skipped: RUN_ID });
    assert.deepEqual(calls, [{ path: `/sessions/${SESSION_ID}/runs/${RUN_ID}/skip`, method: "POST" }]);
  });
});
