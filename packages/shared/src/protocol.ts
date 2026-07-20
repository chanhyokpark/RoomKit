import { z } from 'zod';
import { JsonValueSchema } from './json.js';

/**
 * Socket.io wire contract for M2+. Only names and payload shapes live here —
 * no runtime code.
 */

export const DEVICE_NAMESPACE = '/device';
export const ADMIN_NAMESPACE = '/admin';

/** Events on the /device namespace. */
export const DeviceEvents = {
  /** S→C: deliver a command to the device. */
  command: 'command',
  /** C→S: command completion report; resolves waitUntilEnd. */
  ack: 'ack',
  /** C→S: device reports a game event (sensor, button, ...). */
  trigger: 'trigger',
  /** C→S: hint device submits an entered code. */
  hintSubmit: 'hint:submit',
  /** S→C: show a hint step on the hint device. */
  hintShow: 'hint:show',
  /** S→C: broadcast of session state (phase, pause, timer). */
  sessionState: 'session:state',
} as const;

/** Events on the /admin namespace (studio). */
export const AdminEvents = {
  sessionState: 'session:state',
  log: 'log',
  deviceStatus: 'device:status',
} as const;

/** /device connection auth payload. */
export const DeviceAuthSchema = z.object({ deviceCode: z.string().min(1) });
export type DeviceAuth = z.infer<typeof DeviceAuthSchema>;

export const WireCommandTypeSchema = z.enum([
  'play',
  'stop',
  'navigate',
  'reset',
  'message',
]);
export type WireCommandType = z.infer<typeof WireCommandTypeSchema>;

/**
 * S→C command envelope. `id` is the delivery id used for ack idempotency
 * (at-least-once delivery).
 */
export const WireCommandSchema = z.looseObject({
  id: z.uuid(),
  type: WireCommandTypeSchema,
});
export type WireCommand = z.infer<typeof WireCommandSchema>;

export const AckSchema = z.object({
  commandId: z.uuid(),
  status: z.enum(['done', 'failed']),
});
export type Ack = z.infer<typeof AckSchema>;

export const TriggerSchema = z.object({
  event: z.string().min(1),
  payload: JsonValueSchema.optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const HintSubmitSchema = z.object({ code: z.string().min(1) });
export type HintSubmit = z.infer<typeof HintSubmitSchema>;

export const HintShowSchema = z.object({
  hintId: z.uuid(),
  /** 0-based step index. */
  step: z.number().int().nonnegative(),
  stepCount: z.number().int().positive(),
  textHtml: z.string(),
  imageUrl: z.url().nullable(),
});
export type HintShow = z.infer<typeof HintShowSchema>;

export const SessionModeSchema = z.enum(['test', 'production']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionStateValueSchema = z.enum(['running', 'paused', 'ended']);
export type SessionStateValue = z.infer<typeof SessionStateValueSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.uuid(),
  themeId: z.uuid(),
  mode: SessionModeSchema,
  phaseId: z.uuid().nullable(),
  state: SessionStateValueSchema,
  /** Null when the theme has no timer. */
  timerRemainingMs: z.number().int().nonnegative().nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
