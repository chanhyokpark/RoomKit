import { DeviceEvalInputSchema } from '@roomkit/shared';
import { ConnectionRegistry } from './connection-registry';
import { DeviceEvalService } from './device-eval.service';

describe('DeviceEvalService', () => {
  const session = { id: 'session', mode: 'test', state: 'running' };
  const input = DeviceEvalInputSchema.parse({ code: 'return 42;' });
  let registry: ConnectionRegistry;
  let service: DeviceEvalService;
  let socket: { timeout: jest.Mock; emitWithAck: jest.Mock };

  beforeEach(() => {
    registry = new ConnectionRegistry();
    service = new DeviceEvalService(registry);
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
});
