import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { SessionModeSchema, SessionStateValueSchema, VerdictSchema } from './protocol.js';

export const SessionSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  mode: SessionModeSchema,
  phaseId: z.uuid().nullable(),
  state: SessionStateValueSchema,
  /** Game outcome recorded by the endTheme command; null until it runs. */
  verdict: VerdictSchema.nullable().default(null),
  vars: z.record(z.string(), JsonValueSchema),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  /** Set while the timer is running. */
  timerEndsAt: z.coerce.date().nullable(),
  /** Set while the timer is paused. */
  timerRemainingMs: z.number().int().nullable(),
  /** Test sessions only: websiteId → replacement URL applied at resolution. */
  urlOverrides: z.record(z.string(), z.string()).default({}),
});
export type Session = z.infer<typeof SessionSchema>;

/** One website-URL substitution row (test sessions only). */
export const SessionUrlOverrideSchema = z.object({
  websiteId: z.uuid(),
  url: z.string().min(1),
});
export type SessionUrlOverride = z.infer<typeof SessionUrlOverrideSchema>;

/** Operator-entered test code for one device (test sessions only). */
export const DeviceCodeInputSchema = z.object({
  deviceId: z.uuid(),
  code: z.string().min(1),
});
export type DeviceCodeInput = z.infer<typeof DeviceCodeInputSchema>;

/**
 * Sessions are created idle; POST /sessions/:id/start begins the game.
 * Test mode takes exactly one of `deviceCodes` (operator-entered, may be
 * empty) or `playerId` (server generates codes for every theme device and
 * pushes them to the connected player). Production mode rejects both.
 */
export const CreateSessionInputSchema = z
  .object({
    themeId: z.uuid(),
    mode: SessionModeSchema,
    deviceCodes: z.array(DeviceCodeInputSchema).optional(),
    /** Connected player launcher that should auto-open the device windows. */
    playerId: z.uuid().optional(),
    /** With `playerId`: mint codes for this device subset only (default: all). */
    deviceIds: z.array(z.uuid()).optional(),
    /** Test sessions only: substitute website asset URLs for this session. */
    urlOverrides: z.array(SessionUrlOverrideSchema).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === 'test') {
      if (input.deviceCodes === undefined && input.playerId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['deviceCodes'],
          message: 'deviceCodes or playerId is required for test sessions',
        });
      }
      if (input.deviceCodes !== undefined && input.playerId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['playerId'],
          message: 'deviceCodes and playerId are mutually exclusive',
        });
      }
      if (input.deviceIds !== undefined && input.playerId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['deviceIds'],
          message: 'deviceIds requires playerId',
        });
      }
    }
    if (input.mode === 'production') {
      for (const key of ['deviceCodes', 'playerId', 'deviceIds', 'urlOverrides'] as const) {
        if (input[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is only allowed for test sessions`,
          });
        }
      }
    }
  });
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const TestDeviceCodeSchema = z.object({
  deviceId: z.uuid(),
  deviceName: z.string(),
  displayName: z.string(),
  code: z.string(),
});
export type TestDeviceCode = z.infer<typeof TestDeviceCodeSchema>;

/** /player `test:start` payload — open a stage window per device. */
export const PlayerTestStartSchema = z.object({
  sessionId: z.uuid(),
  themeId: z.uuid(),
  devices: z.array(TestDeviceCodeSchema),
});
export type PlayerTestStart = z.infer<typeof PlayerTestStartSchema>;

/** Create/get response; `testDeviceCodes` present only for test sessions. */
export const SessionResponseSchema = SessionSchema.extend({
  testDeviceCodes: z.array(TestDeviceCodeSchema).optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const ListSessionsQuerySchema = z.object({
  themeId: z.uuid().optional(),
  /** When 'true', only sessions with state != ended. */
  active: z.enum(['true', 'false']).optional(),
});
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;

/** Same shape as the adjustTimer command's `adjustment`. */
export const AdjustTimerInputSchema = z.union([
  z.object({ deltaMs: z.number().int() }),
  z.object({ action: z.enum(['pause', 'resume']) }),
]);
export type AdjustTimerInput = z.infer<typeof AdjustTimerInputSchema>;

export const SwitchPhaseInputSchema = z.object({ phaseId: z.uuid() });
export type SwitchPhaseInput = z.infer<typeof SwitchPhaseInputSchema>;

export const ManualTriggerInputSchema = z.object({ eventId: z.uuid() });
export type ManualTriggerInput = z.infer<typeof ManualTriggerInputSchema>;

/**
 * Debug window: run a website-registered test callback on one device.
 * POST /sessions/:id/devices/:deviceId/test-callback — test sessions only.
 */
export const RunTestCallbackInputSchema = z.object({ name: z.string().min(1) });
export type RunTestCallbackInput = z.infer<typeof RunTestCallbackInputSchema>;

/** Admin pushes an arbitrary hint step to the theme's hint device(s). */
export const PushHintInputSchema = z.object({
  hintId: z.uuid(),
  /** 0-based; defaults to the first step. */
  step: z.number().int().nonnegative().default(0),
});
export type PushHintInput = z.infer<typeof PushHintInputSchema>;
