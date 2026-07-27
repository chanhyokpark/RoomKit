import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { CommandSchema } from './commands.js';
import { TimerStateSchema } from './protocol.js';
import { TestDeviceCodeSchema } from './sessions.js';

/**
 * Website test: an ephemeral, in-memory-only run that points one player
 * device window at an arbitrary URL so a website can be exercised (manual
 * commands, authored events, trigger reporting) without creating a session.
 * Nothing here is ever persisted; a server restart discards all runs.
 */

export const CreateWebsiteTestInputSchema = z.object({
  themeId: z.uuid(),
  /** Connected player launcher that opens the device window. */
  playerId: z.uuid(),
  deviceId: z.uuid(),
  url: z.url(),
});
export type CreateWebsiteTestInput = z.infer<typeof CreateWebsiteTestInputSchema>;

export const WebsiteTestCommandInputSchema = z.object({ command: CommandSchema });
export type WebsiteTestCommandInput = z.infer<typeof WebsiteTestCommandInputSchema>;

export const RunWebsiteTestEventInputSchema = z.object({ eventId: z.uuid() });
export type RunWebsiteTestEventInput = z.infer<typeof RunWebsiteTestEventInputSchema>;

/** Same shape as AdjustTimerInput's pause/resume, plus absolute set. */
export const WebsiteTestTimerInputSchema = z.union([
  z.object({ action: z.enum(['pause', 'resume']) }),
  z.object({ remainingMs: z.number().int().nonnegative() }),
]);
export type WebsiteTestTimerInput = z.infer<typeof WebsiteTestTimerInputSchema>;

export const UpdateWebsiteTestInputSchema = z.object({
  /** Re-point the window at a new URL. */
  url: z.url().optional(),
  /** Simulated phase (affects only trigger-match reporting); null = none. */
  phaseId: z.uuid().nullable().optional(),
});
export type UpdateWebsiteTestInput = z.infer<typeof UpdateWebsiteTestInputSchema>;

/** Run snapshot: REST responses and the /admin `websiteTest:state` broadcast. */
export const WebsiteTestRunSchema = z.object({
  runId: z.uuid(),
  themeId: z.uuid(),
  playerId: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  displayName: z.string(),
  url: z.url(),
  code: z.string(),
  phaseId: z.uuid().nullable(),
  deviceOnline: z.boolean(),
  /**
   * @roomkit/client version of the attached device window: null = the client
   * sent none (predates reporting), absent = not attached yet (or old server).
   */
  clientVersion: z.string().nullable().optional(),
  /**
   * @roomkit/helper version of the site under test: null = a helper said
   * hello without a version, absent = no helper detected (yet).
   */
  helperVersion: z.string().nullable().optional(),
  /** False once stopped — the terminal state broadcast. */
  active: z.boolean(),
  timerState: TimerStateSchema.nullable(),
  timerRemainingMs: z.number().int().nonnegative().nullable(),
  /** Epoch ms. */
  createdAt: z.number().int().nonnegative(),
});
export type WebsiteTestRun = z.infer<typeof WebsiteTestRunSchema>;

/** /player `websiteTest:start` payload — open one stage window. */
export const PlayerWebsiteTestStartSchema = z.object({
  runId: z.uuid(),
  themeId: z.uuid(),
  url: z.url(),
  device: TestDeviceCodeSchema,
});
export type PlayerWebsiteTestStart = z.infer<typeof PlayerWebsiteTestStartSchema>;

/** /player `websiteTest:stop` payload — close the run's window. */
export const PlayerWebsiteTestStopSchema = z.object({ runId: z.uuid() });
export type PlayerWebsiteTestStop = z.infer<typeof PlayerWebsiteTestStopSchema>;

/** An event whose device trigger matched a website-fired trigger. */
export const WebsiteTestMatchedEventSchema = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  phaseId: z.uuid().nullable(),
  /** Whether the event would be admitted under the run's simulated phase. */
  inSimulatedPhase: z.boolean(),
});
export type WebsiteTestMatchedEvent = z.infer<typeof WebsiteTestMatchedEventSchema>;

export const WebsiteTestCommandStatusSchema = z.enum([
  'sent',
  'done',
  'failed',
  'skipped',
  'blocked',
  'offline',
  'timeout',
]);
export type WebsiteTestCommandStatus = z.infer<typeof WebsiteTestCommandStatusSchema>;

const activityBase = {
  id: z.uuid(),
  runId: z.uuid(),
  /** Epoch ms. */
  at: z.number().int().nonnegative(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
};

/** /admin `websiteTest:activity` — one append-only activity log entry. */
export const WebsiteTestActivitySchema = z.discriminatedUnion('kind', [
  /** The website (or the test overlay) fired a trigger — reported, never executed. */
  z.object({
    ...activityBase,
    kind: z.literal('trigger'),
    event: z.string(),
    payload: JsonValueSchema.optional(),
    matches: z.array(WebsiteTestMatchedEventSchema),
  }),
  /** The website submitted a hint code — reported only. */
  z.object({ ...activityBase, kind: z.literal('hint'), code: z.string() }),
  /** Outcome of one dispatched/blocked/skipped command. */
  z.object({
    ...activityBase,
    kind: z.literal('command'),
    source: z.enum(['manual', 'event']),
    commandType: z.string(),
    status: WebsiteTestCommandStatusSchema,
    eventRunId: z.uuid().optional(),
    entryIndex: z.number().int().nonnegative().optional(),
  }),
  /** Lifecycle of one studio-initiated event run. */
  z.object({
    ...activityBase,
    kind: z.literal('eventRun'),
    eventRunId: z.uuid(),
    eventId: z.uuid(),
    eventName: z.string(),
    status: z.enum(['started', 'finished', 'aborted']),
  }),
  /** Free-form status line (device on/offline, navigate, timer changes…). */
  z.object({ ...activityBase, kind: z.literal('status') }),
]);
export type WebsiteTestActivity = z.infer<typeof WebsiteTestActivitySchema>;
