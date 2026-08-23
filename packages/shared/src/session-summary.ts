import { z } from 'zod';
import { VerdictSchema } from './protocol.js';

/** Aggregated time for one phase; revisits/restarts merge into one row. */
export const PhaseTimeSchema = z.object({
  /** Asset id (kind=phase); null for time spent with no phase. */
  phaseId: z.uuid().nullable(),
  /** Wall-clock time including paused intervals. */
  wallMs: z.number().int().nonnegative(),
  /** Wall-clock minus paused intervals. */
  activeMs: z.number().int().nonnegative(),
  /** Times the phase was entered. */
  entries: z.number().int().positive(),
});
export type PhaseTime = z.infer<typeof PhaseTimeSchema>;

export const HintUsageSchema = z.object({
  hintId: z.uuid(),
  /** Hint code from player entry; null when only admin-pushed. */
  code: z.string().nullable(),
  /** Times shown via player code entry. */
  shows: z.number().int().nonnegative(),
  adminPushes: z.number().int().nonnegative(),
  /** Highest 0-based step seen (the answer counts as step `stepCount`). */
  maxStep: z.number().int().nonnegative(),
  /** Times the explicit answer was shown (defaulted for older servers). */
  answerShows: z.number().int().nonnegative().default(0),
  firstAt: z.coerce.date(),
});
export type HintUsage = z.infer<typeof HintUsageSchema>;

export const SessionTimerSummarySchema = z.object({
  timeLimitMs: z.number().int().nullable(),
  /** ms left when the session ended; 0 when expired; null if unknowable. */
  remainingMsAtEnd: z.number().int().nonnegative().nullable(),
  expired: z.boolean(),
  adjustmentCount: z.number().int().nonnegative(),
});
export type SessionTimerSummary = z.infer<typeof SessionTimerSummarySchema>;

/** Post-game analytics reconstructed from the session row and its logs. */
export const SessionSummarySchema = z.object({
  sessionId: z.uuid(),
  verdict: VerdictSchema.nullable(),
  /** Null when the session ended without ever starting. */
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  totalWallMs: z.number().int().nonnegative(),
  totalActiveMs: z.number().int().nonnegative(),
  pauseCount: z.number().int().nonnegative(),
  totalPausedMs: z.number().int().nonnegative(),
  /** Null when the theme has no timer and no timer state was recorded. */
  timer: SessionTimerSummarySchema.nullable(),
  phases: z.array(PhaseTimeSchema),
  hints: z.array(HintUsageSchema),
  phaseRestartCount: z.number().int().nonnegative(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
