import { Injectable } from '@nestjs/common';
import {
  BgmDataSchema,
  DialogueDataSchema,
  PlayerDataSchema,
  SfxDataSchema,
  VideoDataSchema,
  type DeviceAssetEntry,
  type DeviceAssetManifest,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MEDIA_URL_EXPIRES_IN } from '../runtime/command-resolver';

/**
 * Builds the per-device media manifest for `assets:manifest`.
 *
 * Which files a device can ever be told to play is determined by Player asset
 * membership: audio (bgm/sfx/dialogue lines) goes to speaker devices, video to
 * screen devices (screen-side dialogue needs no files — subtitleHtml rides in
 * the wire command). Which *specific* asset targets which player is decided
 * per-command, so the manifest over-approximates to all theme media of the
 * relevant kinds. The cache is an optimization only: wire commands always
 * carry presigned URLs, so an uncached file just streams.
 */
@Injectable()
export class DeviceAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async buildManifest(
    themeId: string,
    deviceId: string,
  ): Promise<DeviceAssetManifest> {
    const players = await this.prisma.asset.findMany({
      where: { themeId, kind: 'player' },
      select: { data: true },
    });
    let isSpeaker = false;
    let isScreen = false;
    for (const row of players) {
      const parsed = PlayerDataSchema.safeParse(row.data);
      if (!parsed.success) continue; // tolerate invalid rows, like the resolver
      if (parsed.data.speakerDeviceId === deviceId) isSpeaker = true;
      if (parsed.data.screenDeviceId === deviceId) isScreen = true;
    }

    const kinds = [
      ...(isSpeaker ? (['bgm', 'sfx', 'dialogue'] as const) : []),
      ...(isScreen ? (['video'] as const) : []),
    ];
    const entries: DeviceAssetEntry[] = [];
    const seen = new Set<string>();
    if (kinds.length > 0) {
      const assets = await this.prisma.asset.findMany({
        where: { themeId, kind: { in: [...kinds] } },
        select: { id: true, kind: true, name: true, data: true },
      });
      for (const asset of assets) {
        for (const file of assetFiles(asset)) {
          if (seen.has(file.fileKey)) continue;
          seen.add(file.fileKey);
          entries.push({
            assetId: asset.id,
            kind: asset.kind as DeviceAssetEntry['kind'],
            name: asset.name,
            ...file,
            url: await this.storage.presignGet(
              file.fileKey,
              MEDIA_URL_EXPIRES_IN,
            ),
          });
        }
      }
    }

    return {
      themeId,
      deviceId,
      urlExpiresAt: Date.now() + MEDIA_URL_EXPIRES_IN * 1000,
      entries,
    };
  }
}

function assetFiles(asset: {
  kind: string;
  data: unknown;
}): { fileKey: string; lineId?: string }[] {
  switch (asset.kind) {
    case 'bgm':
    case 'sfx':
    case 'video': {
      const schema =
        asset.kind === 'bgm'
          ? BgmDataSchema
          : asset.kind === 'sfx'
            ? SfxDataSchema
            : VideoDataSchema;
      const parsed = schema.safeParse(asset.data);
      // Placeholder assets (fileKey null) have nothing to cache.
      return parsed.success && parsed.data.fileKey !== null
        ? [{ fileKey: parsed.data.fileKey }]
        : [];
    }
    case 'dialogue': {
      const parsed = DialogueDataSchema.safeParse(asset.data);
      if (!parsed.success) return [];
      return parsed.data.lines.flatMap((line) =>
        line.fileKey !== null
          ? [{ fileKey: line.fileKey, lineId: line.id }]
          : [],
      );
    }
    default:
      return [];
  }
}
