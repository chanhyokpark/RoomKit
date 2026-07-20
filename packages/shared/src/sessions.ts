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

export const CreateSessionInputSchema = z.object({
  themeId: z.uuid(),
  mode: SessionModeSchema,
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
