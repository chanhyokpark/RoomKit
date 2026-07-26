import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AdjustTimerInputSchema,
  AssetSchema,
  SessionLogEntrySchema,
  SessionResponseSchema,
  SessionSchema,
  SessionSummarySchema,
} from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme, ToolError } from '../session.js';

const ControlActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('restart_phase') }),
  z.object({ type: z.literal('reset_devices') }),
  z.object({ type: z.literal('adjust_timer'), adjustment: AdjustTimerInputSchema }),
  z.object({ type: z.literal('switch_phase'), phaseId: z.uuid() }),
  z.object({ type: z.literal('trigger_event'), eventId: z.uuid() }),
  z.object({
    type: z.literal('push_hint'),
    hintId: z.uuid(),
    step: z.number().int().nonnegative().default(0),
  }),
]);

export const sessionTools = [
  defineTool({
    name: 'create_session',
    description:
      'Create a session (idle until control_session {type:"start"}). Default mode "test": when neither deviceCodes nor playerId is given, per-device codes are auto-generated for every device asset — connect virtual devices with them via connect_virtual_devices. Pass playerId (a connected player launcher) to open real device windows instead. Production mode takes neither (physical devices register with their asset codes); only one non-ended production session per theme. Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      mode: z.enum(['test', 'production']).default('test'),
      deviceCodes: z
        .array(z.object({ deviceId: z.uuid(), code: z.string().min(1) }))
        .optional()
        .describe('Operator-chosen test codes per device (test mode only)'),
      playerId: z.uuid().optional().describe('Connected player launcher id (test mode only)'),
    }),
    handler: async ({ themeId, mode, deviceCodes, playerId }, ctx) => {
      const resolvedThemeId = requireTheme(ctx.state, themeId);
      let codes = deviceCodes;
      let generated: Array<{ deviceId: string; deviceName: string; code: string }> | undefined;

      if (mode === 'test' && !codes && !playerId) {
        const devices = await ctx.api.api(`/themes/${resolvedThemeId}/assets`, {
          query: { kind: 'device' },
          schema: z.array(AssetSchema),
        });
        if (!devices.length) {
          throw new ToolError('The theme has no device assets — create at least one device first.');
        }
        generated = devices.map((d) => ({
          deviceId: d.id,
          deviceName: d.name,
          code: `mcp-${randomUUID().slice(0, 12)}`,
        }));
        codes = generated.map(({ deviceId, code }) => ({ deviceId, code }));
      }

      const session = await ctx.api.api('/sessions', {
        method: 'POST',
        body: { themeId: resolvedThemeId, mode, deviceCodes: codes, playerId },
        schema: SessionResponseSchema,
      });
      return {
        session,
        generatedDeviceCodes: generated,
        next:
          mode === 'test' && generated
            ? 'connect_virtual_devices with these codes (or open them in real device windows), then control_session {type:"start"}.'
            : 'control_session {type:"start"} when devices are connected.',
      };
    },
  }),

  defineTool({
    name: 'control_session',
    description:
      'Drive a session: start / pause / resume / end / restart_phase / reset_devices, {type:"adjust_timer", adjustment:{deltaMs}|{action:"pause"|"resume"}}, {type:"switch_phase", phaseId}, {type:"trigger_event", eventId} (fires a manual-triggerable event), {type:"push_hint", hintId, step}. start fires session:start system events and arms the timer.',
    inputSchema: z.object({ sessionId: z.uuid(), action: ControlActionSchema }),
    handler: async ({ sessionId, action }, ctx) => {
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
          await ctx.api.api(`/sessions/${sessionId}/trigger`, {
            method: 'POST',
            body: { eventId: action.eventId },
          });
          return { triggered: action.eventId, note: 'Poll get_session_logs to observe the run.' };
        case 'reset_devices':
          await ctx.api.api(`/sessions/${sessionId}/reset-devices`, { method: 'POST' });
          return { ok: true };
        case 'push_hint':
          await ctx.api.api(`/sessions/${sessionId}/hint`, {
            method: 'POST',
            body: { hintId: action.hintId, step: action.step },
          });
          return { ok: true };
      }
    },
  }),

  defineTool({
    name: 'list_sessions',
    description:
      'List sessions. Scoped to the selected theme unless themeId is given or allThemes is set. activeOnly filters out ended sessions.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      activeOnly: z.boolean().default(false),
      allThemes: z.boolean().default(false),
    }),
    handler: ({ themeId, activeOnly, allThemes }, ctx) =>
      ctx.api.api('/sessions', {
        query: {
          themeId: allThemes ? undefined : (themeId ?? ctx.state.selectedTheme?.id),
          active: activeOnly ? 'true' : undefined,
        },
        schema: z.array(SessionSchema),
      }),
  }),

  defineTool({
    name: 'get_session',
    description:
      'Fetch a session\'s live state (phase, run state, timer, verdict; test device codes for test sessions).',
    inputSchema: z.object({ sessionId: z.uuid() }),
    handler: ({ sessionId }, ctx) =>
      ctx.api.api(`/sessions/${sessionId}`, { schema: SessionResponseSchema }),
  }),

  defineTool({
    name: 'get_session_summary',
    description: 'Post-game analytics for an ended session (the server answers 409 while it is still running).',
    inputSchema: z.object({ sessionId: z.uuid() }),
    handler: ({ sessionId }, ctx) =>
      ctx.api.api(`/sessions/${sessionId}/summary`, { schema: SessionSummarySchema }),
  }),

  defineTool({
    name: 'get_session_logs',
    description:
      'Fetch session logs ascending by id (events fired, commands executed/skipped, phase/timer changes, device on/offline). Poll incrementally by passing the last seen id as afterId. Limit max 500 (default 100).',
    inputSchema: z.object({
      sessionId: z.uuid(),
      afterId: z.number().int().optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    handler: async ({ sessionId, afterId, limit }, ctx) => {
      const logs = await ctx.api.api(`/sessions/${sessionId}/logs`, {
        query: {
          afterId: afterId === undefined ? undefined : String(afterId),
          limit: limit === undefined ? undefined : String(limit),
        },
        schema: z.array(SessionLogEntrySchema),
      });
      return { logs, nextAfterId: logs.length ? logs[logs.length - 1].id : afterId ?? 0 };
    },
  }),

  defineTool({
    name: 'delete_session',
    description: 'PERMANENTLY delete a session and its logs.',
    inputSchema: z.object({ sessionId: z.uuid() }),
    handler: async ({ sessionId }, ctx) => {
      await ctx.api.api(`/sessions/${sessionId}`, { method: 'DELETE' });
      return { deleted: sessionId };
    },
  }),
];
