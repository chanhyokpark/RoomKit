import { z } from 'zod';
import {
  CommandSchema,
  UpdateWebsiteTestInputSchema,
  WebsiteTestActivitySchema,
  WebsiteTestRunSchema,
  WebsiteTestTimerInputSchema,
} from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme } from '../session.js';

const ControlActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), command: CommandSchema }),
  z.object({ type: z.literal('run_event'), eventId: z.uuid() }),
  z.object({ type: z.literal('cancel_run') }),
  z.object({ type: z.literal('reload') }),
  z.object({ type: z.literal('timer'), timer: WebsiteTestTimerInputSchema }),
  z.object({ type: z.literal('update'), update: UpdateWebsiteTestInputSchema }),
  z.object({ type: z.literal('stop') }),
]);

export const websiteTestTools = [
  defineTool({
    name: 'create_website_test',
    description:
      'Start a website test: an ephemeral run (never persisted, gone on server restart) that opens one device window on a connected player launcher pointed at an arbitrary URL — the fastest way to exercise a real website without a session. Requires a running player app (its playerId is shown in the player/studio UI). The website\'s fired triggers are reported (with matching events), never executed. Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      playerId: z.uuid().describe('Connected player launcher id'),
      deviceId: z.uuid().describe('Device asset the window impersonates'),
      url: z.url().describe('Website URL to load'),
    }),
    handler: ({ themeId, playerId, deviceId, url }, ctx) =>
      ctx.api.api('/website-test', {
        method: 'POST',
        body: { themeId: requireTheme(ctx.state, themeId), playerId, deviceId, url },
        schema: WebsiteTestRunSchema,
      }),
  }),

  defineTool({
    name: 'list_website_tests',
    description: 'List active website-test runs for the theme. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: z.uuid().optional() }),
    handler: ({ themeId }, ctx) =>
      ctx.api.api('/website-test', {
        query: { themeId: requireTheme(ctx.state, themeId) },
        schema: z.array(WebsiteTestRunSchema),
      }),
  }),

  defineTool({
    name: 'control_website_test',
    description:
      'Drive a website-test run: {type:"command", command} sends one sequence command to the device; {type:"run_event", eventId} runs an authored event against it; cancel_run aborts the running event; reload recreates the iframe; {type:"timer", timer:{action:"pause"|"resume"}|{remainingMs}} controls the simulated timer; {type:"update", update:{url?, phaseId?}} re-points the URL / sets the simulated phase; stop ends the run and closes the window.',
    inputSchema: z.object({ runId: z.uuid(), action: ControlActionSchema }),
    handler: async ({ runId, action }, ctx) => {
      switch (action.type) {
        case 'command':
          await ctx.api.api(`/website-test/${runId}/command`, {
            method: 'POST',
            body: { command: action.command },
          });
          return { sent: true, note: 'Check get_website_test_activity for the command outcome.' };
        case 'run_event':
          await ctx.api.api(`/website-test/${runId}/run-event`, {
            method: 'POST',
            body: { eventId: action.eventId },
          });
          return { started: true, note: 'Check get_website_test_activity for the run.' };
        case 'cancel_run':
          await ctx.api.api(`/website-test/${runId}/cancel-run`, { method: 'POST' });
          return { ok: true };
        case 'reload':
          await ctx.api.api(`/website-test/${runId}/reload`, { method: 'POST' });
          return { ok: true };
        case 'timer':
          return ctx.api.api(`/website-test/${runId}/timer`, {
            method: 'POST',
            body: action.timer,
            schema: WebsiteTestRunSchema,
          });
        case 'update':
          return ctx.api.api(`/website-test/${runId}`, {
            method: 'PATCH',
            body: action.update,
            schema: WebsiteTestRunSchema,
          });
        case 'stop':
          await ctx.api.api(`/website-test/${runId}`, { method: 'DELETE' });
          return { stopped: runId };
      }
    },
  }),

  defineTool({
    name: 'get_website_test_activity',
    description:
      'The run\'s append-only activity log — your observation channel: triggers the website fired (with which events they would match), hint code submissions, command outcomes, event-run lifecycle, device on/offline.',
    inputSchema: z.object({
      runId: z.uuid(),
      limit: z.number().int().positive().max(500).default(50).describe('Most recent N entries'),
    }),
    handler: async ({ runId, limit }, ctx) => {
      const activity = await ctx.api.api(`/website-test/${runId}/activity`, {
        schema: z.array(WebsiteTestActivitySchema),
      });
      return activity.slice(-limit);
    },
  }),
];
