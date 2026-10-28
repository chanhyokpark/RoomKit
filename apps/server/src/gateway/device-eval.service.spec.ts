import {
  DeviceEvalInputSchema,
  DeviceReloadInputSchema,
  DeviceWindowInputSchema,
} from '@roomkit/shared';
import type { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ConnectionRegistry } from './connection-registry';
import { DeviceEvalService } from './device-eval.service';

describe('DeviceEvalService', () => {
  const session = { id: 'session', mode: 'test', state: 'running' };
  const input = DeviceEvalInputSchema.parse({ code: 'return 42;' });
  let registry: ConnectionRegistry;
  let service: DeviceEvalService;
  let socket: { timeout: jest.Mock; emitWithAck: jest.Mock };
  let runtime: { reloadWebsite: jest.Mock };

  beforeEach(() => {
    registry = new ConnectionRegistry();
    runtime = {
      reloadWebsite: jest.fn(async () => ({
        websiteId: crypto.randomUUID(),
        url: 'http://localhost:5173/',
        status: 'done',
      })),
    };
    service = new DeviceEvalService(
      registry,
      runtime as unknown as SessionRuntimeService,
    );
    socket = {
      timeout: jest.fn().mockReturnThis(),
      emitWithAck: jest.fn(async (_event, request) => ({
        requestId: request.requestId,
        result: { ok: true, value: 42 },
      })),
    };
    jest.spyOn(registry, 'socketsFor').mockReturnValue([socket as never]);
  });

  it('targets one socket and returns its correlated JSON result', async () => {
    expect(await service.evaluate(session, 'device', input)).toMatchObject({
      result: { ok: true, value: 42 },
    });
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    expect(socket.emitWithAck).toHaveBeenCalledWith(
      'device:eval',
      expect.objectContaining({
        code: input.code,
        requestId: expect.any(String),
      }),
    );
  });

  it('refuses production, ended sessions, offline devices and duplicate windows', async () => {
    await expect(
      service.evaluate({ ...session, mode: 'production' }, 'device', input),
    ).rejects.toThrow('live test');
    await expect(
      service.evaluate({ ...session, state: 'ended' }, 'device', input),
    ).rejects.toThrow('live test');
    jest.spyOn(registry, 'socketsFor').mockReturnValue([]);
    await expect(service.evaluate(session, 'device', input)).rejects.toThrow(
      'offline',
    );
    jest
      .spyOn(registry, 'socketsFor')
      .mockReturnValue([socket as never, socket as never]);
    await expect(service.evaluate(session, 'device', input)).rejects.toThrow(
      'multiple',
    );
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });

  it('does not retry lost replies and releases the device slot', async () => {
    socket.emitWithAck.mockRejectedValue(new Error('timeout'));
    expect(await service.evaluate(session, 'device', input)).toMatchObject({
      result: { ok: false, error: { code: 'device_unavailable' } },
    });
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    await service.evaluate(session, 'device', input);
    expect(socket.emitWithAck).toHaveBeenCalledTimes(2);
  });

  it('rejects an unrelated reply and detects a missing requested image', async () => {
    socket.emitWithAck.mockResolvedValueOnce({
      requestId: crypto.randomUUID(),
      result: { ok: true, value: 42 },
    });
    expect(await service.evaluate(session, 'device', input)).toMatchObject({
      result: { ok: false, error: { code: 'invalid_result' } },
    });
    expect(
      await service.evaluate(session, 'device', { ...input, screenshot: true }),
    ).toMatchObject({
      result: { ok: true, value: 42 },
      screenshotError: { code: 'capture_failed' },
    });
  });

  it('rejects concurrent execution on the same device', async () => {
    let resolve!: (value: unknown) => void;
    socket.emitWithAck.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = service.evaluate(session, 'device', input);
    await expect(service.evaluate(session, 'device', input)).rejects.toThrow(
      'Another evaluation',
    );
    resolve(null);
    await first;
  });

  it('answers window requests through the same single-window RPC path', async () => {
    socket.emitWithAck.mockImplementation(async (_event, request) => ({
      requestId: request.requestId,
      result: { ok: true, value: { visible: true, focused: true, platform: 'macos' } },
    }));
    const input = DeviceWindowInputSchema.parse({ focus: true, screenshot: true });
    expect(await service.window(session, 'device', input)).toMatchObject({
      result: { ok: true, value: { focused: true } },
      screenshotError: { code: 'capture_failed' },
    });
    expect(socket.emitWithAck).toHaveBeenCalledWith(
      'device:window',
      expect.objectContaining({ focus: true, screenshot: true }),
    );
    await expect(
      service.window({ ...session, mode: 'production' }, 'device', input),
    ).rejects.toThrow('live test');
  });

  it('reloads through the runtime and waits for the helper hello armed beforehand', async () => {
    const input = DeviceReloadInputSchema.parse({ waitReady: true, timeoutMs: 500 });
    runtime.reloadWebsite.mockImplementation(async () => {
      // The reloaded page says hello while the load ack is still pending.
      registry.setVersions('session', 'device', { helperVersion: '0.9.0', helperTestCallbacks: ['reset'] });
      return { websiteId: crypto.randomUUID(), url: 'http://localhost:5173/', status: 'done' };
    });
    expect(await service.reload(session, 'device', input)).toMatchObject({
      loaded: true,
      status: 'done',
      helperReady: true,
      helperVersion: '0.9.0',
      helperTestCallbacks: ['reset'],
    });
    expect(runtime.reloadWebsite).toHaveBeenCalledWith('session', 'device', 500);

    // No hello within the deadline → loaded but not ready; nothing is retried.
    runtime.reloadWebsite.mockResolvedValue({ websiteId: crypto.randomUUID(), url: 'http://x.example/', status: 'done' });
    expect(await service.reload(session, 'device', input)).toMatchObject({ loaded: true, helperReady: false });
    expect(runtime.reloadWebsite).toHaveBeenCalledTimes(2);

    // Without waitReady the hello is not awaited at all.
    const quick = await service.reload(session, 'device', DeviceReloadInputSchema.parse({}));
    expect(quick.helperReady).toBeUndefined();

    // A failed load reports loaded:false and skips the hello wait.
    runtime.reloadWebsite.mockResolvedValue({ websiteId: crypto.randomUUID(), url: 'http://x.example/', status: 'timeout' });
    expect(await service.reload(session, 'device', input)).toMatchObject({ loaded: false, status: 'timeout', helperReady: false });

    jest.spyOn(registry, 'socketsFor').mockReturnValue([]);
    await expect(service.reload(session, 'device', input)).rejects.toThrow('offline');
  });

  it('forgets a stale helper on navigate without resolving hello waiters', async () => {
    registry.setVersions('s', 'd', { clientVersion: '0.6.0', helperVersion: '0.9.0', helperMessages: ['m'] });
    const waiter = registry.waitForHelperInfo('s', 'd', 200);
    registry.clearHelper('s', 'd');
    expect(registry.versionsFor('s', 'd')).toEqual({ clientVersion: '0.6.0' });
    registry.setVersions('s', 'd', { clientVersion: '0.6.1' });
    registry.setVersions('s', 'd', { helperVersion: null });
    expect(await waiter.promise).toEqual({ clientVersion: '0.6.1', helperVersion: null });
    expect(await registry.waitForHelperInfo('s', 'd', 20).promise).toBeNull();
    const cancelled = registry.waitForHelperInfo('s', 'd', 10_000);
    cancelled.cancel();
    expect(await cancelled.promise).toBeNull();
  });
});
