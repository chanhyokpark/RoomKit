import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionLog } from '@prisma/client';
import { z } from 'zod';
import type {
  HintUsage,
  PhaseTime,
  SessionSummary,
  SessionTimerSummary,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';

const PhaseSwitchDataSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
});

const HintShownDataSchema = z.object({
  hintId: z.string(),
  code: z.string(),
  step: z.number().int().nonnegative(),
  /** Absent on logs from servers predating explicit answers. */
  isAnswer: z.boolean().optional(),
});

const HintPushDataSchema = z.object({
  hintId: z.string(),
  step: z.number().int().nonnegative(),
  isAnswer: z.boolean().optional(),
});

interface Interval {
  start: number;
  end: number;
}

/**
 * Reconstructs post-game analytics from the session row and its logs.
 * `kind` and `data` are unvalidated in the DB, so every payload is
 * safeParse'd and malformed rows are skipped. Log `at` timestamps come from
 * async fire-and-forget writes, so boundaries carry sub-second slop —
 * acceptable for operator analytics.
 */
@Injectable()
export class SessionSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(id: string): Promise<SessionSummary> {
    const row = await this.prisma.session.findUnique({
      where: { id },
      include: { theme: { select: { timeLimitMs: true } } },
    });
    if (!row) throw new NotFoundException('Session not found');
    // The engine broadcasts 'ended' before the row persists; clients retry.
    if (row.state !== 'ended') {
      throw new ConflictException('Session has not ended');
    }

    const logs = await this.prisma.sessionLog.findMany({
      where: {
        sessionId: id,
        kind: { in: ['session', 'phase', 'timer', 'hint'] },
      },
      orderBy: { id: 'asc' },
    });

    const startLog = logs.find(
      (log) => log.kind === 'session' && log.message === 'Session started',
    );
    const started = startLog ? startLog.at.getTime() : null;
    const ended = (
      row.endedAt ??
      logs[logs.length - 1]?.at ??
      new Date()
    ).getTime();

    const pauses = collectPauses(logs, ended);
    const totalPausedMs = pauses.reduce((sum, p) => sum + (p.end - p.start), 0);

    const totalWallMs = started !== null ? Math.max(0, ended - started) : 0;
    const totalActiveMs = Math.max(0, totalWallMs - totalPausedMs);

    return {
      sessionId: row.id,
      verdict: row.verdict,
      startedAt: startLog ? startLog.at : null,
      endedAt: row.endedAt,
      totalWallMs,
      totalActiveMs,
      pauseCount: pauses.length,
      totalPausedMs,
      timer: computeTimer(row, logs, started, ended),
      phases: computePhases(row.phaseId, logs, started, ended, pauses),
      hints: computeHints(logs),
      phaseRestartCount: logs.filter(
        (log) => log.kind === 'phase' && log.message.includes('restarted'),
      ).length,
    };
  }
}

/** Session-level pauses only; timer-only pauses (kind 'timer') don't stop play. */
function collectPauses(logs: SessionLog[], ended: number): Interval[] {
  const pauses: Interval[] = [];
  let open: number | null = null;
  for (const log of logs) {
    if (log.kind !== 'session') continue;
    if (log.message === 'Session paused' && open === null) {
      open = log.at.getTime();
    } else if (log.message === 'Session resumed' && open !== null) {
      pauses.push({ start: open, end: log.at.getTime() });
      open = null;
    }
  }
  if (open !== null) pauses.push({ start: open, end: Math.max(open, ended) });
  return pauses;
}

function overlapMs(pauses: Interval[], start: number, end: number): number {
  let total = 0;
  for (const p of pauses) {
    total += Math.max(0, Math.min(p.end, end) - Math.max(p.start, start));
  }
  return total;
}

function computePhases(
  rowPhaseId: string | null,
  logs: SessionLog[],
  started: number | null,
  ended: number,
  pauses: Interval[],
): PhaseTime[] {
  if (started === null) return [];

  const switches: { at: number; from: string | null; to: string }[] = [];
  for (const log of logs) {
    if (log.kind !== 'phase' || !log.message.includes('switched')) continue;
    const parsed = PhaseSwitchDataSchema.safeParse(log.data);
    if (!parsed.success) continue;
    switches.push({ at: log.at.getTime(), ...parsed.data });
  }

  const segments: { phaseId: string | null; start: number; end: number }[] = [];
  let cursor = started;
  let current = switches[0]?.from ?? rowPhaseId;
  for (const sw of switches) {
    segments.push({
      phaseId: current,
      start: cursor,
      end: Math.max(cursor, sw.at),
    });
    cursor = Math.max(cursor, sw.at);
    current = sw.to;
  }
  segments.push({
    phaseId: current,
    start: cursor,
    end: Math.max(cursor, ended),
  });

  const byPhase = new Map<string | null, PhaseTime>();
  for (const seg of segments) {
    const wall = seg.end - seg.start;
    const active = Math.max(0, wall - overlapMs(pauses, seg.start, seg.end));
    const entry = byPhase.get(seg.phaseId);
    if (entry) {
      entry.wallMs += wall;
      entry.activeMs += active;
      entry.entries += 1;
    } else {
      byPhase.set(seg.phaseId, {
        phaseId: seg.phaseId,
        wallMs: wall,
        activeMs: active,
        entries: 1,
      });
    }
  }
  return [...byPhase.values()];
}

function computeTimer(
  row: {
    timerEndsAt: Date | null;
    timerRemainingMs: number | null;
    theme: { timeLimitMs: number | null };
  },
  logs: SessionLog[],
  started: number | null,
  ended: number,
): SessionTimerSummary | null {
  const { timeLimitMs } = row.theme;
  if (
    timeLimitMs === null &&
    row.timerEndsAt === null &&
    row.timerRemainingMs === null
  ) {
    return null;
  }

  // end() leaves the last persisted timer state on the row (see
  // session-engine.ts end()): running → timerEndsAt, paused/expired →
  // timerRemainingMs (0 when expired), never armed → both null.
  let remainingMsAtEnd: number | null;
  if (row.timerEndsAt !== null) {
    remainingMsAtEnd = Math.max(0, row.timerEndsAt.getTime() - ended);
  } else if (row.timerRemainingMs !== null) {
    remainingMsAtEnd = Math.max(0, row.timerRemainingMs);
  } else if (started === null) {
    remainingMsAtEnd = timeLimitMs;
  } else {
    remainingMsAtEnd = null;
  }

  const hasExpiredLog = logs.some(
    (log) => log.kind === 'timer' && log.message === 'Timer expired',
  );
  return {
    timeLimitMs,
    remainingMsAtEnd,
    expired:
      remainingMsAtEnd === 0 || (remainingMsAtEnd === null && hasExpiredLog),
    adjustmentCount: logs.filter(
      (log) =>
        log.kind === 'timer' && log.message.startsWith('Timer adjusted by'),
    ).length,
  };
}

function computeHints(logs: SessionLog[]): HintUsage[] {
  const byHint = new Map<string, HintUsage>();
  const bucket = (hintId: string, at: Date): HintUsage => {
    let entry = byHint.get(hintId);
    if (!entry) {
      entry = {
        hintId,
        code: null,
        shows: 0,
        adminPushes: 0,
        maxStep: 0,
        answerShows: 0,
        firstAt: at,
      };
      byHint.set(hintId, entry);
    }
    return entry;
  };

  for (const log of logs) {
    if (log.kind !== 'hint') continue;
    if (log.message.includes('pushed by admin')) {
      const parsed = HintPushDataSchema.safeParse(log.data);
      if (!parsed.success) continue;
      const entry = bucket(parsed.data.hintId, log.at);
      entry.adminPushes += 1;
      entry.maxStep = Math.max(entry.maxStep, parsed.data.step);
      if (parsed.data.isAnswer) entry.answerShows += 1;
    } else if (log.message.includes('shown')) {
      const parsed = HintShownDataSchema.safeParse(log.data);
      if (!parsed.success) continue;
      const entry = bucket(parsed.data.hintId, log.at);
      entry.shows += 1;
      entry.code = parsed.data.code;
      entry.maxStep = Math.max(entry.maxStep, parsed.data.step);
      if (parsed.data.isAnswer) entry.answerShows += 1;
    }
  }
  return [...byHint.values()].sort(
    (a, b) => a.firstAt.getTime() - b.firstAt.getTime(),
  );
}
