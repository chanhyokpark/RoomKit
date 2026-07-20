import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  assetDataSchemas,
  type AssetKind,
  type Command,
  type DialogueData,
  type JsonValue,
  type MessageData,
  type PlayerData,
  type WireCommand,
  type WireDialogueLine,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Media URLs are redelivered to reconnecting devices, so they are signed for
 * far longer than the default 10-minute upload presign.
 */
export const MEDIA_URL_EXPIRES_IN = 6 * 60 * 60;

/** Resolution failures are logged and the command is skipped — never fatal to the run. */
export class ResolutionError extends Error {}

export interface Delivery {
  deviceId: string;
  wire: WireCommand;
}

export interface Resolution {
  deliveries: Delivery[];
  /** Set when the authoring command has waitUntilEnd: whose ack ends the wait. */
  awaitAckOf?: { deviceId: string; commandId: string };
  /**
   * Dialogue split across devices: progress relay from speaker to screen.
   * On the speaker's ack the engine relays `lineIndex: lineCount` as an
   * end-of-dialogue sentinel.
   */
  relay?: {
    fromCommandId: string;
    toDeviceId: string;
    toCommandId: string;
    lineCount: number;
  };
}

type ParsedAsset<K extends AssetKind> = {
  id: string;
  name: string;
  data: import('zod').infer<(typeof assetDataSchemas)[K]>;
};

@Injectable()
export class CommandResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Resolves one authoring command into wire deliveries. Only device-directed
   * commands come through here; wait/eval/switchPhase/callEvent/adjustTimer
   * are interpreted by the engine itself.
   */
  async resolve(themeId: string, cmd: Command): Promise<Resolution> {
    switch (cmd.type) {
      case 'resetDevice': {
        const device = await this.getAsset(themeId, cmd.deviceId, 'device');
        return {
          deliveries: [
            { deviceId: device.id, wire: { id: randomUUID(), type: 'reset' } },
          ],
        };
      }
      case 'resetAllDevices': {
        const devices = await this.prisma.asset.findMany({
          where: { themeId, kind: 'device' },
          select: { id: true },
        });
        return {
          deliveries: devices.map((d) => ({
            deviceId: d.id,
            wire: { id: randomUUID(), type: 'reset' as const },
          })),
        };
      }
      case 'playBgm': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        const bgm = await this.getAsset(themeId, cmd.bgmId, 'bgm');
        return {
          deliveries: [
            {
              deviceId: player.data.speakerDeviceId,
              wire: {
                id: randomUUID(),
                type: 'play',
                channel: 'bgm',
                playerId: player.id,
                assetId: bgm.id,
                fileKey: bgm.data.fileKey,
                url: await this.mediaUrl(bgm.data.fileKey),
                loop: cmd.loop,
              },
            },
          ],
        };
      }
      case 'playSfx': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        const sfx = await this.getAsset(themeId, cmd.sfxId, 'sfx');
        return {
          deliveries: [
            {
              deviceId: player.data.speakerDeviceId,
              wire: {
                id: randomUUID(),
                type: 'play',
                channel: 'sfx',
                playerId: player.id,
                assetId: sfx.id,
                fileKey: sfx.data.fileKey,
                url: await this.mediaUrl(sfx.data.fileKey),
              },
            },
          ],
        };
      }
      case 'playVideo': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        const video = await this.getAsset(themeId, cmd.videoId, 'video');
        const wire = {
          id: randomUUID(),
          type: 'play' as const,
          channel: 'video' as const,
          playerId: player.id,
          assetId: video.id,
          fileKey: video.data.fileKey,
          url: await this.mediaUrl(video.data.fileKey),
        };
        return {
          deliveries: [{ deviceId: player.data.screenDeviceId, wire }],
          awaitAckOf: cmd.waitUntilEnd
            ? { deviceId: player.data.screenDeviceId, commandId: wire.id }
            : undefined,
        };
      }
      case 'playDialogue':
        return this.resolvePlayDialogue(themeId, cmd);
      case 'stopBgm':
      case 'stopSfx': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        const channel =
          cmd.type === 'stopBgm' ? ('bgm' as const) : ('sfx' as const);
        return {
          deliveries: [
            {
              deviceId: player.data.speakerDeviceId,
              wire: {
                id: randomUUID(),
                type: 'stop',
                channel,
                playerId: player.id,
              },
            },
          ],
        };
      }
      case 'stopVideo': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        return {
          deliveries: [
            {
              deviceId: player.data.screenDeviceId,
              wire: {
                id: randomUUID(),
                type: 'stop',
                channel: 'video',
                playerId: player.id,
              },
            },
          ],
        };
      }
      case 'stopDialogue': {
        const player = await this.getPlayer(themeId, cmd.playerId);
        const targets = [
          ...new Set([player.data.speakerDeviceId, player.data.screenDeviceId]),
        ];
        return {
          deliveries: targets.map((deviceId) => ({
            deviceId,
            wire: {
              id: randomUUID(),
              type: 'stop' as const,
              channel: 'dialogue' as const,
              playerId: player.id,
            },
          })),
        };
      }
      case 'navigate': {
        const device = await this.getAsset(themeId, cmd.deviceId, 'device');
        const website = await this.getAsset(themeId, cmd.websiteId, 'website');
        return {
          deliveries: [
            {
              deviceId: device.id,
              wire: {
                id: randomUUID(),
                type: 'navigate',
                websiteId: website.id,
                url: website.data.url,
              },
            },
          ],
        };
      }
      case 'sendMessage': {
        const device = await this.getAsset(themeId, cmd.deviceId, 'device');
        const message = await this.getAsset(themeId, cmd.messageId, 'message');
        return {
          deliveries: [
            {
              deviceId: device.id,
              wire: {
                id: randomUUID(),
                type: 'message',
                messageId: message.id,
                messageName: message.name,
                payload: buildMessagePayload(message.data, cmd.values),
              },
            },
          ],
        };
      }
      default:
        throw new ResolutionError(
          `Command type ${(cmd as Command).type} is not device-directed`,
        );
    }
  }

  private async resolvePlayDialogue(
    themeId: string,
    cmd: Extract<Command, { type: 'playDialogue' }>,
  ): Promise<Resolution> {
    const player = await this.getPlayer(themeId, cmd.playerId);
    const dialogue = await this.getAsset(themeId, cmd.dialogueId, 'dialogue');
    const lines: WireDialogueLine[] = await Promise.all(
      dialogue.data.lines.map(async (line) => ({
        lineId: line.id,
        fileKey: line.fileKey,
        url: await this.mediaUrl(line.fileKey),
        subtitleHtml: line.subtitleHtml,
      })),
    );
    const base = {
      type: 'play' as const,
      channel: 'dialogue' as const,
      playerId: player.id,
      assetId: dialogue.id,
      lines,
      subtitleCss: player.data.subtitleCss,
      keepSubtitleAfterEnd: dialogue.data.keepSubtitleAfterEnd,
    };
    const { speakerDeviceId, screenDeviceId } = player.data;

    if (speakerDeviceId === screenDeviceId) {
      const wire = { ...base, id: randomUUID(), role: 'both' as const };
      return {
        deliveries: [{ deviceId: speakerDeviceId, wire }],
        awaitAckOf: cmd.waitUntilEnd
          ? { deviceId: speakerDeviceId, commandId: wire.id }
          : undefined,
      };
    }

    const speakerWire = { ...base, id: randomUUID(), role: 'speaker' as const };
    const screenWire = { ...base, id: randomUUID(), role: 'screen' as const };
    return {
      deliveries: [
        { deviceId: speakerDeviceId, wire: speakerWire },
        { deviceId: screenDeviceId, wire: screenWire },
      ],
      awaitAckOf: cmd.waitUntilEnd
        ? { deviceId: speakerDeviceId, commandId: speakerWire.id }
        : undefined,
      relay: {
        fromCommandId: speakerWire.id,
        toDeviceId: screenDeviceId,
        toCommandId: screenWire.id,
        lineCount: lines.length,
      },
    };
  }

  private async getPlayer(themeId: string, id: string | null) {
    return this.getAsset(themeId, id, 'player') as Promise<
      ParsedAsset<'player'> & { data: PlayerData }
    >;
  }

  private async getAsset<K extends AssetKind>(
    themeId: string,
    id: string | null,
    kind: K,
  ): Promise<ParsedAsset<K>> {
    // Null = the editor saved a work-in-progress command with the ref unset.
    if (id === null) throw new ResolutionError(`${kind} reference not set`);
    const asset = await this.prisma.asset.findFirst({
      where: { id, themeId, kind },
    });
    if (!asset)
      throw new ResolutionError(`${kind} asset ${id} not found in theme`);
    const parsed = assetDataSchemas[kind].safeParse(asset.data);
    if (!parsed.success) {
      throw new ResolutionError(`${kind} asset ${id} has invalid data`);
    }
    return {
      id: asset.id,
      name: asset.name,
      data: parsed.data,
    } as ParsedAsset<K>;
  }

  private mediaUrl(fileKey: string): Promise<string> {
    return this.storage.presignGet(fileKey, MEDIA_URL_EXPIRES_IN);
  }
}

function buildMessagePayload(
  message: MessageData,
  values: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {};
  for (const field of message.fields) {
    const value = values[field.key];
    if (value === undefined) {
      if (field.required) {
        throw new ResolutionError(
          `Missing required message field "${field.key}"`,
        );
      }
      continue;
    }
    const ok =
      field.type === 'json' ||
      (field.type === 'string' && typeof value === 'string') ||
      (field.type === 'number' && typeof value === 'number') ||
      (field.type === 'boolean' && typeof value === 'boolean');
    if (!ok) {
      throw new ResolutionError(
        `Message field "${field.key}" expects ${field.type}`,
      );
    }
    payload[field.key] = value;
  }
  return payload;
}
