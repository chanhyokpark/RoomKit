import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { SessionModeSchema, SessionStateValueSchema } from './protocol.js';

export const SessionSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  mode: SessionModeSchema,
  phaseId: z.uuid().nullable(),
  state: SessionStateValueSchema,
  vars: z.record(z.string(), JsonValueSchema),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  /** Set while the timer is running. */
  timerEndsAt: z.coerce.date().nullable(),
  /** Set while the timer is paused. */
  timerRemainingMs: z.number().int().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Operator-entered test code for one device (test sessions only). */
export const DeviceCodeInputSchema = z.object({
  deviceId: z.uuid(),
  code: z.string().min(1),
});
export type DeviceCodeInput = z.infer<typeof DeviceCodeInputSchema>;

/**
 * Sessions are created idle; POST /sessions/:id/start begins the game.
 * `deviceCodes` is required for test mode (may be empty) and rejected for
 * production mode.
 */
export const CreateSessionInputSchema = z
  .object({
    themeId: z.uuid(),
    mode: SessionModeSchema,
    deviceCodes: z.array(DeviceCodeInputSchema).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === 'test' && input.deviceCodes === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['deviceCodes'],
        message: 'deviceCodes is required for test sessions',
      });
    }
    if (input.mode === 'production' && input.deviceCodes !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['deviceCodes'],
        message: 'deviceCodes is only allowed for test sessions',
      });
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

/** Admin pushes an arbitrary hint step to the theme's hint device(s). */
export const PushHintInputSchema = z.object({
  hintId: z.uuid(),
  /** 0-based; defaults to the first step. */
  step: z.number().int().nonnegative().default(0),
});
export type PushHintInput = z.infer<typeof PushHintInputSchema>;
