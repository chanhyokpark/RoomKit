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
  /** S→C: sent once on successful attach (device identity + session state). */
  welcome: 'welcome',
  /** S→C: deliver a command to the device. */
  command: 'command',
  /** C→S: command completion report; resolves waitUntilEnd. */
  ack: 'ack',
  /** C→S: device reports a game event (sensor, button, ...). */
  trigger: 'trigger',
  /**
   * C→S from the speaker device as each dialogue line starts;
   * S→C relayed to the screen device for subtitle sync.
   */
  progress: 'progress',
  /** C→S: hint device submits an entered code. */
  hintSubmit: 'hint:submit',
  /** C→S: hint device requests a specific step of an already-shown hint. */
  hintNext: 'hint:next',
  /** S→C: show a hint step on the hint device. */
  hintShow: 'hint:show',
  /** S→C: hint request rejected (wrong code, bad step, unauthorized, paused). */
  hintError: 'hint:error',
  /** S→C: broadcast of session state (phase, pause, timer). */
  sessionState: 'session:state',
} as const;

/** Events on the /admin namespace (studio). */
export const AdminEvents = {
  sessionState: 'session:state',
  log: 'log',
  deviceStatus: 'device:status',
} as const;

/** /device connection auth payload. `deviceName` is an optional log label. */
export const DeviceAuthSchema = z.object({
  deviceCode: z.string().min(1),
  deviceName: z.string().optional(),
});
export type DeviceAuth = z.infer<typeof DeviceAuthSchema>;

/**
 * connect_error messages that are fatal — the client must stop reconnecting
 * (and forget a stored test code). Any other connect_error is transient.
 */
export const FATAL_CONNECT_ERRORS = ['invalid_code', 'session_ended'] as const;
export type FatalConnectError = (typeof FATAL_CONNECT_ERRORS)[number];

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

/** Stateless step advance: the client asks for the exact step it wants next. */
export const HintNextSchema = z.object({
  hintId: z.uuid(),
  /** 0-based step being requested; server validates bounds. */
  step: z.number().int().nonnegative(),
});
export type HintNext = z.infer<typeof HintNextSchema>;

export const HintShowSchema = z.object({
  hintId: z.uuid(),
  /** Theme-unique hint code (also shown for admin-pushed hints). */
  code: z.string(),
  /** 0-based step index. */
  step: z.number().int().nonnegative(),
  stepCount: z.number().int().positive(),
  textHtml: z.string(),
  imageUrl: z.url().nullable(),
});
export type HintShow = z.infer<typeof HintShowSchema>;

export const HintErrorReasonSchema = z.enum([
  /** hint:submit — code matched no hint in the theme. */
  'unknown_code',
  /** hint:next — hintId is not a hint in this theme. */
  'unknown_hint',
  /** hint:next — step is out of range. */
  'invalid_step',
  /** Sender's device asset is not flagged isHintDevice. */
  'not_hint_device',
  /** Session is paused, ended, or not live. */
  'session_not_running',
]);
export type HintErrorReason = z.infer<typeof HintErrorReasonSchema>;

export const HintErrorSchema = z.object({
  reason: HintErrorReasonSchema,
  /** Echo of the submitted code (unknown_code only). */
  code: z.string().optional(),
  hintId: z.uuid().optional(),
});
export type HintError = z.infer<typeof HintErrorSchema>;

export const SessionModeSchema = z.enum(['test', 'production']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Sessions are created idle ('created') and started explicitly by the operator. */
export const SessionStateValueSchema = z.enum(['created', 'running', 'paused', 'ended']);
export type SessionStateValue = z.infer<typeof SessionStateValueSchema>;

export const TimerStateSchema = z.enum(['running', 'paused', 'expired']);
export type TimerState = z.infer<typeof TimerStateSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.uuid(),
  themeId: z.uuid(),
  mode: SessionModeSchema,
  phaseId: z.uuid().nullable(),
  state: SessionStateValueSchema,
  /** Null when the theme has no timer. */
  timerState: TimerStateSchema.nullable(),
  /**
   * Snapshot at emit time; null when the theme has no timer. Clients tick
   * locally while timerState is 'running' — no per-second broadcasts.
   */
  timerRemainingMs: z.number().int().nonnegative().nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** Payload of the /device `welcome` event, sent once on successful attach. */
export const WelcomeSchema = z.object({
  device: z.object({
    id: z.uuid(),
    name: z.string(),
    displayName: z.string(),
  }),
  session: SessionStateSchema,
});
export type Welcome = z.infer<typeof WelcomeSchema>;

/** /admin connection auth payload (admin JWT). */
export const AdminAuthSchema = z.object({ token: z.string().min(1) });
export type AdminAuth = z.infer<typeof AdminAuthSchema>;

/** /admin `device:status` payload. */
export const DeviceStatusSchema = z.object({
  sessionId: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  online: z.boolean(),
});
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
