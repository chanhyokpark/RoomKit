import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AdjustTimerInputSchema,
  CommandSchema,
  SessionLogEntrySchema,
  SessionResponseSchema,
  SessionRunsSchema,
  SessionSchema,
  SessionSummarySchema,
  type Session,
  type SessionResponse,
} from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { ThemeIndex } from '../refs.js';
import { ToolError } from '../session.js';

/** Asset index of the theme a session belongs to (for key/name refs in session commands). */
export async function sessionIndex(ctx: OpsContext, sessionId: string): Promise<ThemeIndex> {
  const session = await ctx.api.api(`/sessions/${sessionId}`, { schema: SessionSchema });
  return ThemeIndex.load(ctx, session.themeId);
}

export interface CreateSessionInput {
  themeId: string;
  mode?: 'test' | 'production';
  /** Operator-chosen test codes per device (test mode only); refs accept uuid/key/code/name. */
  deviceCodes?: Array<{ deviceId: string; code: string }>;
  /** Connected player launcher id (test mode only). */
  playerId?: string;
  /** With playerId: mint codes for this device subset only. */
  deviceIds?: string[];
  /** Test mode only: substitute website asset URLs for this session. */
  urlOverrides?: Array<{ websiteId: string; url: string }>;
}

export interface CreateSessionResult {
  session: SessionResponse;
  generatedDeviceCodes?: Array<{ deviceId: string; deviceName: string; code: string }>;
}

/**
 * Create a session (idle until `start`). Default mode "test": when neither
 * deviceCodes nor playerId is given, per-device codes are auto-generated for
 * every device asset — connect virtual devices with them.
 */
export async function createSession(ctx: OpsContext, input: CreateSessionInput): Promise<CreateSessionResult> {
  const mode = input.mode ?? 'test';
  const index = await ThemeIndex.load(ctx, input.themeId);
  let codes = input.deviceCodes?.map(({ deviceId, code }) => ({
    deviceId: index.resolveAssetId(deviceId, 'device', 'deviceCodes.deviceId'),
    code,
  }));
  const deviceIds = input.deviceIds?.map((ref) => index.resolveAssetId(ref, 'device', 'deviceIds'));
  const urlOverrides = input.urlOverrides?.map(({ websiteId, url }) => ({
    websiteId: index.resolveAssetId(websiteId, 'website', 'urlOverrides.websiteId'),
    url,
  }));
  let generated: CreateSessionResult['generatedDeviceCodes'];

  if (mode === 'test' && !codes && !input.playerId) {
    const devices = index.assets.filter((d) => d.kind === 'device');
    if (!devices.length) {
      throw new ToolError('The theme has no device assets — create at least one device first.', 'no_devices');
    }
    generated = devices.map((d) => ({ deviceId: d.id, deviceName: d.name, code: `rk-${randomUUID().slice(0, 12)}` }));
    codes = generated.map(({ deviceId, code }) => ({ deviceId, code }));
  }

  const session = await ctx.api.api('/sessions', {
    method: 'POST',
    body: { themeId: input.themeId, mode, deviceCodes: codes, playerId: input.playerId, deviceIds, urlOverrides },
    schema: SessionResponseSchema,
  });
  return { session, generatedDeviceCodes: generated };
}

export const ControlActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('restart_phase') }),
  z.object({ type: z.literal('reset_devices') }),
  z.object({ type: z.literal('adjust_timer'), adjustment: AdjustTimerInputSchema }),
  z.object({ type: z.literal('switch_phase'), phaseId: z.string().min(1) }),
  z.object({ type: z.literal('trigger_event'), eventId: z.string().min(1) }),
  z.object({ type: z.literal('push_hint'), hintId: z.string().min(1), step: z.number().int().nonnegative().default(0) }),
]);
export type ControlAction = z.infer<typeof ControlActionSchema>;

export async function controlSession(ctx: OpsContext, sessionId: string, action: ControlAction): Promise<unknown> {
  if (action.type === 'switch_phase' || action.type === 'trigger_event' || action.type === 'push_hint') {
    const index = await sessionIndex(ctx, sessionId);
    if (action.type === 'switch_phase') action.phaseId = index.resolveAssetId(action.phaseId, 'phase', 'phase');
    if (action.type === 'trigger_event') action.eventId = index.resolveAssetId(action.eventId, 'event', 'event');
    if (action.type === 'push_hint') action.hintId = index.resolveAssetId(action.hintId, 'hint', 'hint');
  }
  const post = (suffix: string, body?: unknown) =>
    ctx.api.api(`/sessions/${sessionId}${suffix}`, {
      method: 'POST',
      ...(body !== undefined && { body }),
      schema: SessionResponseSchema,
    });
  switch (action.type) {
    case 'start':
      return post('/start');
    case 'pause':
      return post('/pause');
    case 'resume':
      return post('/resume');
    case 'end':
      return post('/end');
    case 'restart_phase':
      return post('/phase/restart');
    case 'adjust_timer':
      return post('/timer', action.adjustment);
    case 'switch_phase':
      return post('/phase', { phaseId: action.phaseId });
    case 'trigger_event':
      await ctx.api.api(`/sessions/${sessionId}/trigger`, { method: 'POST', body: { eventId: action.eventId } });
      return { triggered: action.eventId };
    case 'reset_devices':
      await ctx.api.api(`/sessions/${sessionId}/reset-devices`, { method: 'POST' });
      return { ok: true };
    case 'push_hint':
      await ctx.api.api(`/sessions/${sessionId}/hint`, { method: 'POST', body: { hintId: action.hintId, step: action.step } });
      return { ok: true };
  }
}

/** Run one sequence command against a live session, outside any event (fire-and-forget). */
export async function runSessionCommand(ctx: OpsContext, sessionId: string, raw: Record<string, unknown>) {
  const index = await sessionIndex(ctx, sessionId);
  const command = CommandSchema.parse(index.resolveCommand(raw, 'command'));
  await ctx.api.api(`/sessions/${sessionId}/command`, { method: 'POST', body: command });
  return { dispatched: command.type };
}

export function listSessionRuns(ctx: OpsContext, sessionId: string) {
  return ctx.api.api(`/sessions/${sessionId}/runs`, { schema: SessionRunsSchema });
}

export async function abortSessionRun(ctx: OpsContext, sessionId: string, runId: string) {
  await ctx.api.api(`/sessions/${sessionId}/runs/${runId}/abort`, { method: 'POST' });
  return { aborted: runId };
}

export function listSessions(ctx: OpsContext, opts: { themeId?: string; activeOnly?: boolean }): Promise<Session[]> {
  return ctx.api.api('/sessions', {
    query: { themeId: opts.themeId, active: opts.activeOnly ? 'true' : undefined },
    schema: z.array(SessionSchema),
  });
}

export function getSession(ctx: OpsContext, sessionId: string): Promise<SessionResponse> {
  return ctx.api.api(`/sessions/${sessionId}`, { schema: SessionResponseSchema });
}

export function getSessionSummary(ctx: OpsContext, sessionId: string) {
  return ctx.api.api(`/sessions/${sessionId}/summary`, { schema: SessionSummarySchema });
}

export async function getSessionLogs(ctx: OpsContext, sessionId: string, opts: { afterId?: number; limit?: number } = {}) {
  const logs = await ctx.api.api(`/sessions/${sessionId}/logs`, {
    query: {
      afterId: opts.afterId === undefined ? undefined : String(opts.afterId),
      limit: opts.limit === undefined ? undefined : String(opts.limit),
    },
    schema: z.array(SessionLogEntrySchema),
  });
  return { logs, nextAfterId: logs.length ? logs[logs.length - 1]!.id : (opts.afterId ?? 0) };
}

export async function deleteSession(ctx: OpsContext, sessionId: string) {
  await ctx.api.api(`/sessions/${sessionId}`, { method: 'DELETE' });
  return { deleted: sessionId };
}
