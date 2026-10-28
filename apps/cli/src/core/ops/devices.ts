import {
  DeviceEvalInputSchema,
  DeviceEvalResultSchema,
  DeviceReloadInputSchema,
  DeviceReloadResultSchema,
  DeviceWindowInputSchema,
  DeviceWindowResultSchema,
  SessionDevicesResponseSchema,
  SessionResponseSchema,
  type DeviceEvalInput,
  type DeviceReloadInput,
  type DeviceWindowInput,
  type SessionDevicesResponse,
} from '@roomkit/shared';
import { z } from 'zod';
import { ThemeIndex } from '../refs.js';
import type { OpsContext } from '../context.js';
import { ToolError } from '../session.js';
import type { DeviceState } from '../virtual-device.js';

/**
 * Resolve a device reference in the session's theme (independent of the
 * current project theme) for the test-only device RPCs, which all require a
 * live test session.
 */
export async function resolveSessionDevice(ctx: OpsContext, sessionId: string, deviceRef: string, what: string) {
  z.uuid().parse(sessionId);
  const session = await ctx.api.api(`/sessions/${sessionId}`, { schema: SessionResponseSchema });
  if (session.mode !== 'test' || session.state === 'ended') {
    throw new ToolError(`${what} requires a live test session.`, 'test_only');
  }
  const index = await ThemeIndex.load(ctx, session.themeId);
  return { session, deviceId: index.resolveAssetId(deviceRef, 'device') };
}

/** Resolve in the session's theme (independent of the current project theme). Never retry JS. */
export async function evaluateDevice(ctx: OpsContext, sessionId: string, deviceRef: string, input: DeviceEvalInput) {
  const body = DeviceEvalInputSchema.parse(input);
  const { deviceId } = await resolveSessionDevice(ctx, sessionId, deviceRef, 'JS evaluation');
  return ctx.api.api(`/sessions/${sessionId}/devices/${deviceId}/eval`, {
    method: 'POST', body, schema: DeviceEvalResultSchema,
  });
}

/** Bring the device's Player window to the front and/or capture it (no website needed). */
export async function windowDevice(ctx: OpsContext, sessionId: string, deviceRef: string, input: Partial<DeviceWindowInput>) {
  const body = DeviceWindowInputSchema.parse(input);
  const { deviceId } = await resolveSessionDevice(ctx, sessionId, deviceRef, 'A window request');
  return ctx.api.api(`/sessions/${sessionId}/devices/${deviceId}/window`, {
    method: 'POST', body, schema: DeviceWindowResultSchema,
  });
}

/** Force-reload the website the device shows; optionally wait for its Helper hello. */
export async function reloadDevice(ctx: OpsContext, sessionId: string, deviceRef: string, input: Partial<DeviceReloadInput>) {
  const body = DeviceReloadInputSchema.parse(input);
  const { deviceId } = await resolveSessionDevice(ctx, sessionId, deviceRef, 'Website reload');
  return ctx.api.api(`/sessions/${sessionId}/devices/${deviceId}/reload`, {
    method: 'POST', body, schema: DeviceReloadResultSchema,
  });
}

/** Live per-device diagnostics of a session (any mode). */
export function listSessionDevices(ctx: OpsContext, sessionId: string): Promise<SessionDevicesResponse> {
  z.uuid().parse(sessionId);
  return ctx.api.api(`/sessions/${sessionId}/devices`, { schema: SessionDevicesResponseSchema });
}

/**
 * Poll the device list until every device (or the given one) is ready for
 * `eval`: exactly one window online and, when a website is shown, its Helper
 * said hello. Resolves with the last snapshot and whether it became ready.
 */
export async function waitForDevicesReady(
  ctx: OpsContext,
  sessionId: string,
  opts: { deviceId?: string; timeoutMs: number; intervalMs?: number },
): Promise<{ ready: boolean; status: SessionDevicesResponse }> {
  const deadline = Date.now() + opts.timeoutMs;
  const interval = opts.intervalMs ?? 500;
  for (;;) {
    const status = await listSessionDevices(ctx, sessionId);
    const targets = opts.deviceId ? status.devices.filter((d) => d.deviceId === opts.deviceId) : status.devices;
    const ready = targets.length > 0 && targets.every((d) => d.ready);
    if (ready || status.state === 'ended') return { ready, status };
    if (Date.now() + interval > deadline) return { ready: false, status };
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
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
