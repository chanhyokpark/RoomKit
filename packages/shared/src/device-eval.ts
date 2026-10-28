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
