import { DeviceEvalInputSchema, DeviceEvalResultSchema, SessionResponseSchema, type DeviceEvalInput } from '@roomkit/shared';
import { z } from 'zod';
import { ThemeIndex } from '../refs.js';
import type { OpsContext } from '../context.js';
import { ToolError } from '../session.js';
import type { DeviceState } from '../virtual-device.js';

/** Resolve in the session's theme (independent of the current project theme). Never retry JS. */
export async function evaluateDevice(ctx: OpsContext, sessionId: string, deviceRef: string, input: DeviceEvalInput) {
  z.uuid().parse(sessionId);
  const body = DeviceEvalInputSchema.parse(input);
  const session = await ctx.api.api(`/sessions/${sessionId}`, { schema: SessionResponseSchema });
  if (session.mode !== 'test' || session.state === 'ended') {
    throw new ToolError('JS evaluation requires a live test session.', 'test_only');
  }
  const index = await ThemeIndex.load(ctx, session.themeId);
  const deviceId = index.resolveAssetId(deviceRef, 'device');
  return ctx.api.api(`/sessions/${sessionId}/devices/${deviceId}/eval`, {
    method: 'POST', body, schema: DeviceEvalResultSchema,
  });
}

/**
 * Resolve the device codes to connect: explicit codes plus, with a session
 * id, every test device code registered on that session.
 */
export async function resolveDeviceCodes(ctx: OpsContext, codes: string[], sessionId?: string): Promise<string[]> {
  let targets = [...codes];
  if (sessionId) {
    const session = await ctx.api.api(`/sessions/${sessionId}`, { schema: SessionResponseSchema });
    if (!session.testDeviceCodes?.length) {
      throw new ToolError(
        'That session has no test device codes (production session, or codes not registered).',
        'no_device_codes',
      );
    }
    targets = [...targets, ...session.testDeviceCodes.map((d) => d.code)];
  }
  if (!targets.length) throw new ToolError('Pass device codes and/or a session id.', 'usage');
  return [...new Set(targets)];
}

export async function connectDevices(ctx: OpsContext, codes: string[]): Promise<DeviceState[]> {
  await ctx.api.ensureLogin();
  const results = await Promise.all(codes.map((code) => ctx.devices.connect(code)));
  return results.map((r) => ({ ...r, device: ctx.devices.states().find((s) => s.code === r.code)?.device ?? null }));
}

/** Connect one transient device, fire a trigger, and disconnect. */
export async function triggerFromDevice(
  ctx: OpsContext,
  code: string,
  event: string,
  payload: unknown,
  opts: { wait: boolean; timeoutMs: number },
) {
  await ctx.api.ensureLogin();
  const state = await ctx.devices.connect(code);
  if (state.status !== 'connected') {
    throw new ToolError(
      `Could not connect device "${code}": ${state.error ?? state.status}. An invalid_code error means the code is not registered with a live session.`,
      'device_connect_failed',
    );
  }
  try {
    return await ctx.devices.trigger(code, event, payload, opts.wait, opts.timeoutMs);
  } finally {
    ctx.devices.disconnect([code]);
  }
}
