import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assetDataSchemas,
  PlayerDataSchema,
  type AssetKind,
  type Command,
  type JsonValue,
  type MessageData,
  type PlayChannel,
  type PlayerData,
  type WireCommand,
  type WireDialogueLine,
} from '@roomkit/shared';
import type { Env } from '../config/env';
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

export interface ResolveOptions {
  /**
   * Website test: every target collapses onto this device — player assets
   * resolve with speaker/screen overridden (dialogue becomes role 'both'),
   * device refs are ignored in favor of this device, and "all devices/players"
   * variants shrink to just it.
   */
  forceDeviceId?: string;
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
  private readonly publicServerUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.publicServerUrl =
      config.get('PUBLIC_SERVER_URL', { infer: true }) ??
      `http://localhost:${config.get('PORT', { infer: true })}`;
  }

  /**
   * Resolves one authoring command into wire deliveries. Only device-directed
   * commands come through here; wait/eval/switchPhase/callEvent/adjustTimer
   * are interpreted by the engine itself.
   */
  async resolve(
    themeId: string,
    cmd: Command,
    opts: ResolveOptions = {},
  ): Promise<Resolution> {
    switch (cmd.type) {
      case 'resetDevice': {
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
        return {
          deliveries: [
            { deviceId: device.id, wire: { id: randomUUID(), type: 'reset' } },
          ],
        };
      }
      case 'resetAllDevices': {
        const devices = opts.forceDeviceId
          ? [{ id: opts.forceDeviceId }]
          : await this.prisma.asset.findMany({
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
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
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
                ...(await this.mediaFields(bgm.name, bgm.data)),
                loop: cmd.loop,
                fadeInMs: bgm.data.fadeInMs,
                fadeOutMs: bgm.data.fadeOutMs,
              },
            },
          ],
        };
      }
      case 'playSfx': {
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
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
                ...(await this.mediaFields(sfx.name, sfx.data)),
              },
            },
          ],
        };
      }
      case 'playVideo': {
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
        const video = await this.getAsset(themeId, cmd.videoId, 'video');
        const wire = {
          id: randomUUID(),
          type: 'play' as const,
          channel: 'video' as const,
          playerId: player.id,
          assetId: video.id,
          ...(await this.mediaFields(video.name, video.data)),
        };
        return {
          deliveries: [{ deviceId: player.data.screenDeviceId, wire }],
          awaitAckOf: cmd.waitUntilEnd
            ? { deviceId: player.data.screenDeviceId, commandId: wire.id }
            : undefined,
        };
      }
      case 'playDialogue':
        return this.resolvePlayDialogue(themeId, cmd, opts);
      case 'stopBgm':
      case 'stopSfx': {
        const channel =
          cmd.type === 'stopBgm' ? ('bgm' as const) : ('sfx' as const);
        if (cmd.allPlayers) return this.resolveStopAll(themeId, channel, opts);
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
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
        if (cmd.allPlayers) return this.resolveStopAll(themeId, 'video', opts);
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
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
        if (cmd.allPlayers)
          return this.resolveStopAll(themeId, 'dialogue', opts);
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
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
      case 'showHintCode': {
        if (cmd.hintId === null)
          throw new ResolutionError('hint reference not set');
        const hint = await this.prisma.asset.findFirst({
          where: { id: cmd.hintId, themeId, kind: 'hint' },
          select: { id: true, code: true },
        });
        if (!hint)
          throw new ResolutionError(
            `hint asset ${cmd.hintId} not found in theme`,
          );
        if (hint.code === null)
          throw new ResolutionError(`hint asset ${cmd.hintId} has no code`);
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
        return {
          deliveries: [
            {
              deviceId: device.id,
              wire: {
                id: randomUUID(),
                type: 'hintCode',
                code: hint.code,
                css: device.data.hintCodeCss,
              },
            },
          ],
        };
      }
      case 'hideHintCode': {
        const targets = opts.forceDeviceId
          ? [opts.forceDeviceId]
          : cmd.allDevices
            ? (
                await this.prisma.asset.findMany({
                  where: { themeId, kind: 'device' },
                  select: { id: true },
                })
              ).map((d) => d.id)
            : [(await this.getAsset(themeId, cmd.deviceId, 'device')).id];
        return {
          deliveries: targets.map((deviceId) => ({
            deviceId,
            wire: {
              id: randomUUID(),
              type: 'hintCode' as const,
              code: null,
              css: '',
            },
          })),
        };
      }
      case 'navigate': {
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
        const website = await this.getAsset(themeId, cmd.websiteId, 'website');
        const url =
          website.data.mode === 'hosted'
            ? `${this.publicServerUrl}/api/sites/${website.id}/`
            : website.data.url;
        const wire = {
          id: randomUUID(),
          type: 'navigate' as const,
          websiteId: website.id,
          url,
          force: false,
        };
        return {
          deliveries: [{ deviceId: device.id, wire }],
          // Devices ack once the website has actually changed (player: iframe
          // loaded), so later commands can assume the site is ready.
          awaitAckOf: { deviceId: device.id, commandId: wire.id },
        };
      }
      case 'sendMessage': {
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
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
    opts: ResolveOptions = {},
  ): Promise<Resolution> {
    const player = await this.getPlayer(themeId, cmd.playerId, opts);
    const dialogue = await this.getAsset(themeId, cmd.dialogueId, 'dialogue');
    const lines: WireDialogueLine[] = await Promise.all(
      dialogue.data.lines.map(async (line) => ({
        lineId: line.id,
        ...(line.fileKey === null
          ? { fileKey: null, url: null, durationMs: line.durationMs }
          : {
              fileKey: line.fileKey,
              url: await this.mediaUrl(line.fileKey),
              durationMs: null,
            }),
        subtitleHtml: line.subtitleHtml,
      })),
    );
    const base = {
      type: 'play' as const,
      channel: 'dialogue' as const,
      playerId: player.id,
      assetId: dialogue.id,
      assetName: dialogue.name,
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

  /**
   * The "all players" stop: one `playerId: null` wire (= stop everything on
   * the channel) per device that could be playing it. Players with invalid
   * data are skipped; no players means no deliveries — a harmless no-op.
   */
  private async resolveStopAll(
    themeId: string,
    channel: PlayChannel,
    opts: ResolveOptions = {},
  ): Promise<Resolution> {
    const targets = new Set<string>();
    if (opts.forceDeviceId) {
      targets.add(opts.forceDeviceId);
    } else {
      const players = await this.prisma.asset.findMany({
        where: { themeId, kind: 'player' },
        select: { data: true },
      });
      for (const player of players) {
        const parsed = PlayerDataSchema.safeParse(player.data);
        if (!parsed.success) continue;
        const { speakerDeviceId, screenDeviceId } = parsed.data;
        if (channel === 'bgm' || channel === 'sfx')
          targets.add(speakerDeviceId);
        else if (channel === 'video') targets.add(screenDeviceId);
        else {
          targets.add(speakerDeviceId);
          targets.add(screenDeviceId);
        }
      }
    }
    return {
      deliveries: [...targets].map((deviceId) => ({
        deviceId,
        wire: {
          id: randomUUID(),
          type: 'stop' as const,
          channel,
          playerId: null,
        },
      })),
    };
  }

  private async getPlayer(
    themeId: string,
    id: string | null,
    opts: ResolveOptions = {},
  ) {
    const player = (await this.getAsset(
      themeId,
      id,
      'player',
    )) as ParsedAsset<'player'> & { data: PlayerData };
    if (!opts.forceDeviceId) return player;
    return {
      ...player,
      data: {
        ...player.data,
        speakerDeviceId: opts.forceDeviceId,
        screenDeviceId: opts.forceDeviceId,
      },
    };
  }

  /**
   * Device target resolution. With forceDeviceId the command's device ref is
   * ignored entirely and the forced device's own asset is loaded, so wire
   * fields derived from device data (hintCodeCss) match the actual target.
   */
  private async getDevice(
    themeId: string,
    id: string | null,
    opts: ResolveOptions = {},
  ): Promise<ParsedAsset<'device'>> {
    return this.getAsset(themeId, opts.forceDeviceId ?? id, 'device');
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

  /**
   * Wire media fields for a bgm/sfx/video asset. Placeholder assets
   * (fileKey null) get no URL and carry durationMs for client-side simulation.
   */
  private async mediaFields(
    assetName: string,
    data: { fileKey: string | null; durationMs: number },
  ): Promise<{
    assetName: string;
    fileKey: string | null;
    url: string | null;
    durationMs: number | null;
  }> {
    if (data.fileKey === null) {
      return {
        assetName,
        fileKey: null,
        url: null,
        durationMs: data.durationMs,
      };
    }
    return {
      assetName,
      fileKey: data.fileKey,
      url: await this.mediaUrl(data.fileKey),
      durationMs: null,
    };
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
