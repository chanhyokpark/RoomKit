import { z } from 'zod';
import { JsonValueSchema, SessionResponseSchema } from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { ToolError } from '../session.js';

export const deviceTools = [
  defineTool({
    name: 'connect_virtual_devices',
    description:
      'Connect headless virtual devices to the server with device codes — no player app or hardware needed. Pass codes directly (e.g. from create_session\'s generatedDeviceCodes), or a test sessionId to connect all of its devices. Virtual devices log every command they receive and ack immediately (playback is skipped, so waitUntilEnd resolves instantly — logic-accurate, timing-unrealistic).',
    inputSchema: z.object({
      codes: z.array(z.string().min(1)).optional(),
      sessionId: z.uuid().optional().describe('Test session whose device codes should all be connected'),
    }),
    handler: async ({ codes, sessionId }, ctx) => {
      let targets = codes ?? [];
      if (sessionId) {
        const session = await ctx.api.api(`/sessions/${sessionId}`, {
          schema: SessionResponseSchema,
        });
        if (!session.testDeviceCodes?.length) {
          throw new ToolError('That session has no test device codes (production session, or codes not registered).');
        }
        targets = [...targets, ...session.testDeviceCodes.map((d) => d.code)];
      }
      if (!targets.length) throw new ToolError('Pass codes and/or sessionId.');
      const results = await Promise.all(targets.map((code) => ctx.devices.connect(code)));
      const failed = results.filter((r) => r.status !== 'connected');
      return {
        results,
        note: failed.length
          ? 'Some devices failed — an invalid_code error means the code is not registered with a live session.'
          : 'All connected. Commands they receive show up in get_virtual_device_state.',
      };
    },
  }),

  defineTool({
    name: 'get_virtual_device_state',
    description:
      'State of connected virtual devices. Without code: all device summaries. With code: includes the recent send/receive log (commands received and acked, session state broadcasts, hint overlays).',
    inputSchema: z.object({
      code: z.string().min(1).optional(),
      logLimit: z.number().int().positive().max(200).default(25),
    }),
    handler: async ({ code, logLimit }, ctx) => {
      if (!code) return ctx.devices.states();
      const state = ctx.devices.states().find((d) => d.code === code);
      if (!state) throw new ToolError(`No virtual device with code "${code}".`);
      return { ...state, log: ctx.devices.log(code, logLimit) };
    },
  }),

  defineTool({
    name: 'emit_device_trigger',
    description:
      'Fire a device trigger from a virtual device (as if a sensor/button in the room fired) — this is how device-triggered events are exercised. With waitForCompletion (default), resolves once every event run the trigger started has fully finished. The event\'s triggerName must match `event`.',
    inputSchema: z.object({
      code: z.string().min(1).describe('Connected virtual device code'),
      event: z.string().min(1).describe('Trigger name (matches event assets\' triggerName)'),
      payload: JsonValueSchema.optional().describe('Optional payload; sequences can read it as {{payload.x}}'),
      waitForCompletion: z.boolean().default(true),
      timeoutMs: z.number().int().positive().max(120000).default(15000),
    }),
    handler: ({ code, event, payload, waitForCompletion, timeoutMs }, ctx) =>
      ctx.devices.trigger(code, event, payload, waitForCompletion, timeoutMs),
  }),

  defineTool({
    name: 'disconnect_virtual_devices',
    description: 'Disconnect virtual devices (all of them when codes is omitted).',
    inputSchema: z.object({ codes: z.array(z.string().min(1)).optional() }),
    handler: async ({ codes }, ctx) => ({ disconnected: ctx.devices.disconnect(codes) }),
  }),
];
