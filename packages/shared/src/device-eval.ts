import { z } from "zod";
import { JsonValueSchema } from "./json.js";
import { DeviceScreenshotReportSchema } from "./protocol.js";

/** Test-only script RPC, independent of authored commands and their replay/ack rules. */
export const DeviceEvalInputSchema = z.object({
  code: z.string().min(1).max(64_000),
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
  screenshot: z.boolean().default(false),
  screenshotFormat: z.enum(["png", "jpeg"]).default("png"),
});
export type DeviceEvalInput = z.infer<typeof DeviceEvalInputSchema>;

export const DeviceEvalRequestSchema = DeviceEvalInputSchema.extend({
  requestId: z.uuid(),
});
export type DeviceEvalRequest = z.infer<typeof DeviceEvalRequestSchema>;

export const EvalErrorSchema = z.object({
  code: z.string().max(100),
  message: z.string().max(4000),
  stack: z.string().max(8000).optional(),
});
export type EvalError = z.infer<typeof EvalErrorSchema>;

export const EvalOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: JsonValueSchema.refine(
      (value) => JSON.stringify(value).length <= 32_000,
      "Result exceeds 32000 characters",
    ),
  }),
  z.object({ ok: z.literal(false), error: EvalErrorSchema }),
]);
export type EvalOutcome = z.infer<typeof EvalOutcomeSchema>;

export const DeviceEvalResultSchema = z.object({
  requestId: z.uuid(),
  result: EvalOutcomeSchema,
  /** Fresh native capture made after this script, never the periodic cached frame. */
  screenshot: DeviceScreenshotReportSchema.extend({
    capturedAt: z.number().int().nonnegative(),
  }).optional(),
  /** Script may succeed while capture fails; preserve its return value. */
  screenshotError: EvalErrorSchema.optional(),
});
export type DeviceEvalResult = z.infer<typeof DeviceEvalResultSchema>;

/**
 * Test-only window RPC, independent of any website: bring the device window
 * to the front (show, unminimize, focus, wait for paint) and/or capture it.
 * Works on the idle screen and during video playback, where `eval` cannot.
 */
export const DeviceWindowInputSchema = z.object({
  focus: z.boolean().default(false),
  screenshot: z.boolean().default(false),
  screenshotFormat: z.enum(["png", "jpeg"]).default("png"),
  timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
});
export type DeviceWindowInput = z.infer<typeof DeviceWindowInputSchema>;

export const DeviceWindowRequestSchema = DeviceWindowInputSchema.extend({
  requestId: z.uuid(),
});
export type DeviceWindowRequest = z.infer<typeof DeviceWindowRequestSchema>;

export const DeviceWindowStateSchema = z.object({
  /** The document is not hidden (window shown and not occluded/minimized). */
  visible: z.boolean(),
  /** The native window reports keyboard focus (false in the browser harness). */
  focused: z.boolean(),
  /** `web` in the browser dev harness, otherwise the Tauri platform name. */
  platform: z.string().max(40),
});
export type DeviceWindowState = z.infer<typeof DeviceWindowStateSchema>;

export const DeviceWindowResultSchema = z.object({
  requestId: z.uuid(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: DeviceWindowStateSchema }),
    z.object({ ok: z.literal(false), error: EvalErrorSchema }),
  ]),
  screenshot: DeviceScreenshotReportSchema.extend({
    capturedAt: z.number().int().nonnegative(),
  }).optional(),
  screenshotError: EvalErrorSchema.optional(),
});
export type DeviceWindowResult = z.infer<typeof DeviceWindowResultSchema>;

/**
 * Test-only forced reload of the website a device currently shows
 * (`POST /sessions/:id/devices/:deviceId/reload`). The server re-sends the
 * last navigate with `force: true` and waits for the player's load ack;
 * `waitReady` additionally waits for the reloaded page's Helper hello.
 */
export const DeviceReloadInputSchema = z.object({
  waitReady: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(120_000).default(15_000),
});
export type DeviceReloadInput = z.infer<typeof DeviceReloadInputSchema>;

export const DeviceReloadResultSchema = z.object({
  websiteId: z.uuid(),
  url: z.url(),
  /** The player acked the forced navigate as done (iframe load event). */
  loaded: z.boolean(),
  status: z.enum(["done", "failed", "timeout", "ended", "aborted"]),
  /** Only with waitReady: a Helper said hello after the reload. */
  helperReady: z.boolean().optional(),
  helperVersion: z.string().nullable().optional(),
  helperTestCallbacks: z.array(z.string()).nullable().optional(),
});
export type DeviceReloadResult = z.infer<typeof DeviceReloadResultSchema>;

/** One row of `GET /sessions/:id/devices` — live diagnostics for test tooling. */
export const SessionDeviceStatusSchema = z.object({
  deviceId: z.uuid(),
  deviceName: z.string(),
  displayName: z.string(),
  /** Test connection code of this session (test sessions only). */
  code: z.string().nullable(),
  online: z.boolean(),
  /** Connected sockets; eval/window RPCs need exactly one. */
  windows: z.number().int().nonnegative(),
  clientVersion: z.string().nullable().optional(),
  helperVersion: z.string().nullable().optional(),
  helperMessages: z.array(z.string()).nullable().optional(),
  helperTestCallbacks: z.array(z.string()).nullable().optional(),
  helperStates: z.array(z.string()).nullable().optional(),
  /** Website the server last navigated the device to; null = none/unloaded. */
  website: z
    .object({
      websiteId: z.uuid(),
      url: z.url(),
      startedAt: z.number().int().nonnegative(),
    })
    .nullable(),
  state: z
    .object({ stateId: z.uuid(), stateName: z.string(), startedAt: z.number().int().nonnegative() })
    .nullable(),
  /** Epoch ms of the latest periodic stage capture the server holds. */
  screenshotAt: z.number().int().nonnegative().nullable(),
  /**
   * Ready for `eval`: exactly one window online and, when a website is
   * shown, its Helper has said hello.
   */
  ready: z.boolean(),
});
export type SessionDeviceStatus = z.infer<typeof SessionDeviceStatusSchema>;

export const SessionDevicesResponseSchema = z.object({
  sessionId: z.uuid(),
  mode: z.enum(["test", "production"]),
  state: z.string(),
  devices: z.array(SessionDeviceStatusSchema),
});
export type SessionDevicesResponse = z.infer<typeof SessionDevicesResponseSchema>;
