import type { ConfigService } from '@nestjs/config';
import type {
  AdminCallState,
  DeviceCallState,
  SessionState,
} from '@roomkit/shared';
import type { Env } from '../config/env';
import type { SessionRuntimeService } from '../runtime/session-runtime.service';
import { CALL_CONNECT_TIMEOUT_MS, CallService } from './call.service';
import type { ConnectionRegistry, DeviceVersions } from './connection-registry';

const SESSION = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';

function setup(
  overrides: {
    session?: Partial<SessionState> | null;
    online?: boolean;
    versions?: DeviceVersions;
    ice?: unknown;
  } = {},
) {
  const session: SessionState | null =
    overrides.session === null
      ? null
      : {
          sessionId: SESSION,
          themeId: 'theme',
          mode: 'production',
          phaseId: null,
          state: 'running',
          verdict: null,
          timerState: null,
          timerRemainingMs: null,
          ...overrides.session,
        };
  const log = jest.fn();
  const registry = {
    isOnline: jest.fn(() => overrides.online ?? true),
    versionsFor: jest.fn(
      () =>
        overrides.versions ?? {
          clientVersion: '0.5.0',
          helperVersion: '0.8.0',
        },
    ),
  } as unknown as ConnectionRegistry;
  const runtime = {
    getSessionState: jest.fn(() => session),
    log,
  } as unknown as SessionRuntimeService;
  const config = {
    get: jest.fn(() => overrides.ice ?? null),
  } as unknown as ConfigService<Env, true>;
  const service = new CallService(registry, runtime, config);
  const adminStates: AdminCallState[] = [];
  const deviceStates: { deviceId: string; state: DeviceCallState }[] = [];
  service.onAdminChange((s) => adminStates.push(s));
  service.onDeviceState((_s, deviceId, state) =>
    deviceStates.push({ deviceId, state }),
  );
  return { service, adminStates, deviceStates, log };
}

describe('CallService', () => {
  afterEach(() => jest.useRealTimers());

  it('starts a call: connecting for the device, broadcast to admins, ended by the owner only', () => {
    const { service, adminStates, deviceStates } = setup({
      ice: [{ urls: 'stun:x' }],
    });
    const ack = service.start(
      'sock-a',
      { sessionId: SESSION, deviceId: DEVICE, peerId: 'pa' },
      'phone',
    );
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.call).toMatchObject({
      status: 'connecting',
      adminSocketId: 'sock-a',
      adminPeerId: 'pa',
    });
    expect(deviceStates[0].state).toEqual({
      status: 'connecting',
      callId: ack.call.callId,
      adminPeerId: 'pa',
      devicePeerId: ack.call.devicePeerId,
      iceServers: [{ urls: 'stun:x' }],
    });
    expect(adminStates.at(-1)?.call?.status).toBe('connecting');

    expect(service.end('sock-b', { sessionId: SESSION })).toEqual({
      ok: false,
      reason: 'not_owner',
    });
    expect(
      service.start(
        'sock-b',
        { sessionId: SESSION, deviceId: DEVICE, peerId: 'pb' },
        'phone',
      ),
    ).toEqual({
      ok: false,
      reason: 'busy',
    });
    service.report(SESSION, DEVICE, {
      callId: ack.call.callId,
      status: 'connected',
    });
    expect(adminStates.at(-1)?.call?.status).toBe('connected');
    expect(typeof adminStates.at(-1)?.call?.connectedAt).toBe('number');

    expect(service.end('sock-a', { sessionId: SESSION }).ok).toBe(true);
    expect(deviceStates.at(-1)?.state).toEqual({
      status: 'ended',
      callId: ack.call.callId,
      reason: 'admin_ended',
    });
    expect(adminStates.at(-1)).toEqual({
      sessionId: SESSION,
      call: null,
      endReason: 'admin_ended',
    });
    expect(service.listCalls()).toEqual([]);
  });

  it('request → accept/decline/cancel transitions', () => {
    const { service, adminStates, deviceStates } = setup();
    const req = service.request(SESSION, DEVICE, 'phone');
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    expect(adminStates.at(-1)?.call).toMatchObject({
      status: 'requested',
      adminSocketId: null,
    });
    expect(service.request(SESSION, DEVICE, 'phone')).toEqual({
      ok: false,
      reason: 'busy',
    });
    expect(service.end('sock-a', { sessionId: SESSION })).toEqual({
      ok: false,
      reason: 'no_call',
    });
    expect(
      service.accept('sock-a', {
        sessionId: SESSION,
        callId: 'other',
        peerId: 'pa',
      }),
    ).toEqual({
      ok: false,
      reason: 'no_call',
    });

    // cancel only while requested
    service.cancel(SESSION, DEVICE, req.callId);
    expect(deviceStates.at(-1)?.state).toEqual({
      status: 'ended',
      callId: req.callId,
      reason: 'cancelled',
    });

    const req2 = service.request(SESSION, DEVICE, 'phone');
    if (!req2.ok) return;
    const accepted = service.accept('sock-a', {
      sessionId: SESSION,
      callId: req2.callId,
      peerId: 'pa',
    });
    expect(accepted.ok).toBe(true);
    service.cancel(SESSION, DEVICE, req2.callId); // ignored once connecting
    expect(adminStates.at(-1)?.call?.status).toBe('connecting');
    expect(
      service.decline({ sessionId: SESSION, callId: req2.callId }),
    ).toEqual({ ok: false, reason: 'busy' });
    service.adminDisconnected('sock-a');
    expect(adminStates.at(-1)).toEqual({
      sessionId: SESSION,
      call: null,
      endReason: 'admin_disconnected',
    });

    const req3 = service.request(SESSION, DEVICE, 'phone');
    if (!req3.ok) return;
    expect(
      service.decline({ sessionId: SESSION, callId: req3.callId }).ok,
    ).toBe(true);
    expect(deviceStates.at(-1)?.state).toEqual({
      status: 'ended',
      callId: req3.callId,
      reason: 'declined',
    });
  });

  it('refuses per eligibility', () => {
    const input = { sessionId: SESSION, deviceId: DEVICE, peerId: 'p' };
    expect(setup({ session: null }).service.start('s', input, 'd')).toEqual({
      ok: false,
      reason: 'session_not_live',
    });
    expect(
      setup({ session: { state: 'ended' } }).service.start('s', input, 'd'),
    ).toEqual({
      ok: false,
      reason: 'session_not_live',
    });
    expect(
      setup({ session: { mode: 'test' } }).service.request(
        SESSION,
        DEVICE,
        'd',
      ),
    ).toEqual({
      ok: false,
      reason: 'test_session',
    });
    expect(setup({ online: false }).service.start('s', input, 'd')).toEqual({
      ok: false,
      reason: 'device_offline',
    });
    expect(
      setup({ versions: { clientVersion: '0.5.0' } }).service.start(
        's',
        input,
        'd',
      ),
    ).toEqual({
      ok: false,
      reason: 'no_helper',
    });
    expect(
      setup({
        versions: { clientVersion: '0.4.9', helperVersion: '0.8.0' },
      }).service.start('s', input, 'd'),
    ).toEqual({ ok: false, reason: 'device_outdated' });
  });

  it('times out a call the device never connects, and device failure/offline/session end clear it', () => {
    jest.useFakeTimers();
    const { service, adminStates, deviceStates, log } = setup();
    const a = service.start(
      's',
      { sessionId: SESSION, deviceId: DEVICE, peerId: 'p' },
      'd',
    );
    if (!a.ok) return;
    jest.advanceTimersByTime(CALL_CONNECT_TIMEOUT_MS + 1);
    expect(adminStates.at(-1)).toEqual({
      sessionId: SESSION,
      call: null,
      endReason: 'timeout',
    });
    expect(deviceStates.at(-1)?.state).toMatchObject({
      status: 'ended',
      reason: 'timeout',
    });

    const b = service.start(
      's',
      { sessionId: SESSION, deviceId: DEVICE, peerId: 'p' },
      'd',
    );
    if (!b.ok) return;
    service.report(SESSION, DEVICE, {
      callId: b.call.callId,
      status: 'failed',
      reason: 'mic_denied',
    });
    expect(adminStates.at(-1)?.endReason).toBe('device_failed');
    expect(log).toHaveBeenCalledWith(
      SESSION,
      'warn',
      'call',
      expect.stringContaining('failed'),
      expect.objectContaining({ reason: 'mic_denied' }),
    );

    const c = service.start(
      's',
      { sessionId: SESSION, deviceId: DEVICE, peerId: 'p' },
      'd',
    );
    if (!c.ok) return;
    const before = deviceStates.length;
    service.deviceOffline(SESSION, DEVICE);
    expect(deviceStates.length).toBe(before); // an offline device is not notified
    expect(adminStates.at(-1)?.endReason).toBe('device_offline');

    const d = service.start(
      's',
      { sessionId: SESSION, deviceId: DEVICE, peerId: 'p' },
      'd',
    );
    if (!d.ok) return;
    service.sessionEnded(SESSION);
    expect(deviceStates.at(-1)?.state).toMatchObject({
      status: 'ended',
      reason: 'session_ended',
    });
    jest.advanceTimersByTime(CALL_CONNECT_TIMEOUT_MS + 1);
    expect(adminStates.filter((s) => s.endReason === 'timeout')).toHaveLength(
      1,
    );
  });
});
