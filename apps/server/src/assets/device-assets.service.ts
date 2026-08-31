import { Injectable } from '@nestjs/common';
import {
  BgmDataSchema,
  DialogueDataSchema,
  EventDataSchema,
  PlayerDataSchema,
  SfxDataSchema,
  VideoDataSchema,
  type Command,
  type DeviceAssetEntry,
  type DeviceAssetManifest,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MEDIA_URL_EXPIRES_IN } from '../runtime/command-resolver';

type MediaKind = 'bgm' | 'sfx' | 'dialogue' | 'video';

/** One play command's media reference: which asset plays on which player. */
interface MediaUsage {
  kind: MediaKind;
  assetId: string;
  playerId: string;
}

/**
 * Builds the per-device media manifest for `assets:manifest`.
 *
 * Which files a device can ever be told to play is derived from the theme's
 * event sequences: every play command names its media asset and player, and
 * the player maps audio (bgm/sfx/dialogue) to its speaker device and video to
 * its screen device (screen-side dialogue needs no files — subtitleHtml rides
 * in the wire command). All events are walked regardless of reachability
 * (manual, hint-triggered, and callEvent targets included), so the union
 * covers everything the runtime can resolve; eval scripts can only trigger
 * events, never play media directly. The cache is an optimization only: wire
 * commands always carry presigned URLs, so an uncached file just streams —
 * which also makes mid-session theme edits safe, merely uncached.
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
      select: { id: true, data: true },
    });
    const playerDevices = new Map<
      string,
      { speakerDeviceId: string; screenDeviceId: string }
    >();
    for (const row of players) {
      const parsed = PlayerDataSchema.safeParse(row.data);
      if (!parsed.success) continue; // tolerate invalid rows, like the resolver
      playerDevices.set(row.id, {
        speakerDeviceId: parsed.data.speakerDeviceId,
        screenDeviceId: parsed.data.screenDeviceId,
      });
    }

    const events = await this.prisma.asset.findMany({
      where: { themeId, kind: 'event' },
      select: { data: true },
    });
    const requiredIds = new Set<string>();
    for (const row of events) {
      const parsed = EventDataSchema.safeParse(row.data);
      if (!parsed.success) continue;
      for (const usage of collectMediaUsages(parsed.data.sequence)) {
        const player = playerDevices.get(usage.playerId);
        if (!player) continue; // dangling ref — the runtime skips it too
        const target =
          usage.kind === 'video'
            ? player.screenDeviceId
            : player.speakerDeviceId;
        if (target === deviceId) requiredIds.add(usage.assetId);
      }
    }

    const entries: DeviceAssetEntry[] = [];
    const seen = new Set<string>();
    if (requiredIds.size > 0) {
      const assets = await this.prisma.asset.findMany({
        where: {
          themeId,
          id: { in: [...requiredIds] },
          kind: { in: ['bgm', 'sfx', 'dialogue', 'video'] },
        },
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

/**
 * Media play references in a sequence, recursing into dialogue line cues.
 * Commands with an unset media or player ref are omitted — the runtime skips
 * them, so no device will ever receive that file.
 */
function collectMediaUsages(sequence: readonly Command[]): MediaUsage[] {
  const usages: MediaUsage[] = [];
  for (const cmd of sequence) {
    switch (cmd.type) {
      case 'playBgm':
        if (cmd.bgmId !== null && cmd.playerId !== null)
          usages.push({
            kind: 'bgm',
            assetId: cmd.bgmId,
            playerId: cmd.playerId,
          });
        break;
      case 'playSfx':
        if (cmd.sfxId !== null && cmd.playerId !== null)
          usages.push({
            kind: 'sfx',
            assetId: cmd.sfxId,
            playerId: cmd.playerId,
          });
        break;
      case 'playVideo':
        if (cmd.videoId !== null && cmd.playerId !== null)
          usages.push({
            kind: 'video',
            assetId: cmd.videoId,
            playerId: cmd.playerId,
          });
        break;
      case 'playDialogue':
        if (cmd.dialogueId !== null && cmd.playerId !== null)
          usages.push({
            kind: 'dialogue',
            assetId: cmd.dialogueId,
            playerId: cmd.playerId,
          });
        for (const cue of cmd.lineCues)
          usages.push(...collectMediaUsages(cue.sequence));
        break;
      default:
        break;
    }
  }
  return usages;
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
