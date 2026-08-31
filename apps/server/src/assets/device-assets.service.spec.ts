import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { DeviceAssetsService } from './device-assets.service';

describe('DeviceAssetsService', () => {
  const themeId = '10cdef96-9e06-4e89-ba5c-71a920be6fc5';
  const playerId = 'd9ebfa38-a00f-46c5-b184-e8372b2e540e';
  const speakerDeviceId = 'b2242850-b0af-4696-bf18-2fda196105b6';
  const screenDeviceId = '5b0e21bb-4b1a-49ff-9db4-c47a1697577e';
  const bgmId = '1f3ab97e-96a9-4d0f-b95e-2f42a63cd001';
  const unusedSfxId = '1f3ab97e-96a9-4d0f-b95e-2f42a63cd002';
  const cueSfxId = '1f3ab97e-96a9-4d0f-b95e-2f42a63cd003';
  const videoId = '1f3ab97e-96a9-4d0f-b95e-2f42a63cd004';
  const dialogueId = '1f3ab97e-96a9-4d0f-b95e-2f42a63cd005';
  const lineId = '9a1a2b3c-4d5e-4f60-8172-83940a5b6c7d';
  const entryId = () => 'e0e0e0e0-0000-4000-8000-000000000000';

  const players = [
    {
      id: playerId,
      data: { speakerDeviceId, screenDeviceId, subtitleCss: '' },
    },
  ];
  const events = [
    {
      data: {
        phaseId: null,
        triggerKind: 'manual',
        triggerName: null,
        manualTriggerable: true,
        allowReentry: false,
        sequence: [
          {
            id: entryId(),
            type: 'playBgm',
            bgmId,
            playerId,
            loop: true,
          },
          {
            id: entryId(),
            type: 'playVideo',
            videoId,
            playerId,
            waitUntilEnd: false,
          },
          {
            id: entryId(),
            type: 'playDialogue',
            dialogueId,
            playerId,
            waitUntilEnd: false,
            lineCues: [
              {
                afterLineId: lineId,
                sequence: [
                  {
                    id: entryId(),
                    type: 'playSfx',
                    sfxId: cueSfxId,
                    playerId,
                  },
                ],
              },
            ],
          },
          // Unset media/player refs are runtime skips — never in the manifest.
          { id: entryId(), type: 'playSfx', sfxId: null, playerId },
        ],
      },
    },
  ];
  const media = [
    { id: bgmId, kind: 'bgm', name: 'theme bgm', data: { fileKey: 'k-bgm' } },
    {
      id: unusedSfxId,
      kind: 'sfx',
      name: 'unused sfx',
      data: { fileKey: 'k-unused' },
    },
    { id: cueSfxId, kind: 'sfx', name: 'cue sfx', data: { fileKey: 'k-cue' } },
    { id: videoId, kind: 'video', name: 'intro', data: { fileKey: 'k-video' } },
    {
      id: dialogueId,
      kind: 'dialogue',
      name: 'briefing',
      data: {
        keepSubtitleAfterEnd: false,
        lines: [{ id: lineId, fileKey: 'k-line', subtitleHtml: 'hi' }],
      },
    },
  ];

  const makeService = () => {
    const prisma = {
      asset: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
          if (where.kind === 'player') return Promise.resolve(players);
          if (where.kind === 'event') return Promise.resolve(events);
          const ids = (where.id as { in: string[] }).in;
          return Promise.resolve(media.filter((a) => ids.includes(a.id)));
        }),
      },
    } as unknown as PrismaService;
    const storage = {
      presignGet: jest.fn((key: string) => Promise.resolve(`url:${key}`)),
    } as unknown as StorageService;
    return new DeviceAssetsService(prisma, storage);
  };

  it('gives the speaker device only event-referenced audio', async () => {
    const manifest = await makeService().buildManifest(
      themeId,
      speakerDeviceId,
    );

    const keys = manifest.entries.map((e) => e.fileKey).sort();
    expect(keys).toEqual(['k-bgm', 'k-cue', 'k-line']);
    expect(manifest.entries.find((e) => e.fileKey === 'k-line')).toMatchObject({
      assetId: dialogueId,
      lineId,
      url: 'url:k-line',
    });
  });

  it('gives the screen device only event-referenced video', async () => {
    const manifest = await makeService().buildManifest(themeId, screenDeviceId);

    expect(manifest.entries).toEqual([
      expect.objectContaining({ assetId: videoId, fileKey: 'k-video' }),
    ]);
  });

  it('gives a device outside every player an empty manifest', async () => {
    const manifest = await makeService().buildManifest(
      themeId,
      '00000000-0000-4000-8000-000000000000',
    );

    expect(manifest.entries).toEqual([]);
  });
});
