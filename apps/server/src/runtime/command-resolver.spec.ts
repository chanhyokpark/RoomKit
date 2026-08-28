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
        },
      },
    ]);
  });
});
