import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { CommandResolver } from './command-resolver';

describe('CommandResolver', () => {
  it('routes BGM volume adjustments to the player speaker as a factor', async () => {
    const themeId = '10cdef96-9e06-4e89-ba5c-71a920be6fc5';
    const playerId = 'd9ebfa38-a00f-46c5-b184-e8372b2e540e';
    const speakerDeviceId = 'b2242850-b0af-4696-bf18-2fda196105b6';
    const prisma = {
      asset: {
        findFirst: jest.fn().mockResolvedValue({
          id: playerId,
          name: 'main',
          data: {
            speakerDeviceId,
            screenDeviceId: speakerDeviceId,
            subtitleCss: '',
          },
        }),
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) =>
        key === 'PUBLIC_SERVER_URL' ? 'http://localhost:3000' : 3000,
      ),
    } as unknown as ConfigService<Env, true>;
    const resolver = new CommandResolver(prisma, {} as StorageService, config);

    const resolution = await resolver.resolve(themeId, {
      type: 'adjustBgmVolume',
      playerId,
      value: 35,
      durationMs: 1500,
    });

    expect(prisma.asset.findFirst).toHaveBeenCalledWith({
      where: { id: playerId, themeId, kind: 'player' },
    });
    expect(resolution.deliveries).toEqual([
      {
        deviceId: speakerDeviceId,
        wire: {
          id: expect.any(String),
          type: 'bgmVolume',
          playerId,
          value: 0.35,
          durationMs: 1500,
        },
      },
    ]);
  });

  const themeId = '10cdef96-9e06-4e89-ba5c-71a920be6fc5';
  const deviceId = 'b2242850-b0af-4696-bf18-2fda196105b6';
  const stateId = '4f1a4a1e-8a1e-4b1e-9c1e-1e1e1e1e1e1e';
  const config = {
    get: jest.fn((key: string) =>
      key === 'PUBLIC_SERVER_URL' ? 'http://localhost:3000' : 3000,
    ),
  } as unknown as ConfigService<Env, true>;
  const deviceRow = {
    id: deviceId,
    name: 'stage',
    data: { displayName: 'stage', isHintDevice: false, hintCodeCss: '' },
  };
  const stateRow = {
    id: stateId,
    name: 'alarm',
    data: {
      displayName: '경보',
      fields: [
        { key: 'level', label: '', type: 'number', required: true },
        { key: 'label', label: '', type: 'string', required: false },
      ],
    },
  };

  it('setState builds an interpolated, type-checked payload on a state wire', async () => {
    const prisma = {
      asset: {
        findFirst: jest.fn(({ where }: { where: { kind: string } }) =>
          Promise.resolve(where.kind === 'device' ? deviceRow : stateRow),
        ),
      },
    } as unknown as PrismaService;
    const resolver = new CommandResolver(prisma, {} as StorageService, config);
    const resolution = await resolver.resolve(
      themeId,
      { type: 'setState', deviceId, stateId, values: { level: '{{vars.level}}', label: 'L{{vars.level}}' } },
      { vars: { level: 3 } },
    );
    expect(resolution.awaitAckOf).toBeUndefined();
    expect(resolution.deliveries).toEqual([
      {
        deviceId,
        wire: {
          id: expect.any(String),
          type: 'state',
          state: { stateId, stateName: 'alarm', payload: { level: 3, label: 'L3' } },
        },
      },
    ]);
    // missing required field → resolution error (skipped by the engine)
    await expect(
      resolver.resolve(themeId, { type: 'setState', deviceId, stateId, values: {} }),
    ).rejects.toThrow('Missing required message field "level"');
  });

  it('clearState targets one device or fans out to all devices with a null state', async () => {
    const other = '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d';
    const prisma = {
      asset: {
        findFirst: jest.fn().mockResolvedValue(deviceRow),
        findMany: jest.fn().mockResolvedValue([{ id: deviceId }, { id: other }]),
      },
    } as unknown as PrismaService;
    const resolver = new CommandResolver(prisma, {} as StorageService, config);
    const one = await resolver.resolve(themeId, { type: 'clearState', deviceId, allDevices: false });
    expect(one.deliveries).toEqual([
      { deviceId, wire: { id: expect.any(String), type: 'state', state: null } },
    ]);
    const all = await resolver.resolve(themeId, { type: 'clearState', deviceId: null, allDevices: true });
    expect(all.deliveries.map((d) => d.deviceId)).toEqual([deviceId, other]);
  });
});
