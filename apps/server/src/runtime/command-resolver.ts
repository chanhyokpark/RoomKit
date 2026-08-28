import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assetDataSchemas,
  HintDataSchema,
  PlayerDataSchema,
  type AssetKind,
  type Command,
  type JsonValue,
  type MessageData,
  type PlayChannel,
  type PlayerData,
  type WebsiteData,
  type WebsiteRequestMethod,
  type WireCommand,
  type WireDialogueLine,
} from '@roomkit/shared';
import type { DialogueCueEntry } from '@roomkit/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { interpolate, interpolateString, type TemplateScope } from './template';

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
  /** Session variables for {{vars.x}} interpolation; absent = none resolve. */
  vars?: Record<string, JsonValue>;
  /** Trigger payload of the run, for {{payload.x}} interpolation. */
  payload?: JsonValue | null;
  /** Test sessions: websiteId → replacement URL, applied before query params. */
  urlOverrides?: Record<string, string>;
}

export interface Resolution {
  deliveries: Delivery[];
  /** Server-side HTTP request produced by sendWebsiteRequest. */
  websiteRequest?: ResolvedWebsiteRequest;
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
  /**
   * Dialogue line cues: the speaker holds before each line in `byLine` and
   * reports `waiting` progress; the executor runs that line's cue commands,
   * then sends a plain progress back to `deviceId` as the go-ahead.
   */
  dialogueCues?: {
    /** Speaker (or 'both') device — the hold/continue counterpart. */
    deviceId: string;
    /** The speaker wire's id; `waiting` progress arrives under it. */
    commandId: string;
    /** Cue commands keyed by the line index the speaker holds before. */
    byLine: Map<number, DialogueCueEntry[]>;
    /** Cues whose line vanished from the asset or is the last line. */
    dropped: number;
  };
}

export interface ResolvedWebsiteRequest {
  websiteId: string;
  websiteName: string;
  url: string;
  method: WebsiteRequestMethod;
  body: string;
  headers: Array<{ key: string; value: string }>;
  waitUntilEnd: boolean;
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
   * Resolves one authoring command into device wire deliveries or a server-side
   * website request. Flow commands are interpreted by the engine itself.
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
        const wire = {
          id: randomUUID(),
          type: 'play' as const,
          channel: 'bgm' as const,
          playerId: player.id,
          assetId: bgm.id,
          ...(await this.mediaFields(bgm.name, bgm.data)),
          loop: cmd.loop,
          fadeInMs: bgm.data.fadeInMs,
          fadeOutMs: bgm.data.fadeOutMs,
        };
        return {
          deliveries: [{ deviceId: player.data.speakerDeviceId, wire }],
          // Looping playback never "ends" (its ack fires on start), so
          // waitUntilEnd only applies to one-shot BGM.
          awaitAckOf:
            cmd.waitUntilEnd && !cmd.loop
              ? { deviceId: player.data.speakerDeviceId, commandId: wire.id }
              : undefined,
        };
      }
      case 'adjustBgmVolume': {
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
        return {
          deliveries: [
            {
              deviceId: player.data.speakerDeviceId,
              wire: {
                id: randomUUID(),
                type: 'bgmVolume',
                playerId: player.id,
                value: cmd.value / 100,
              },
            },
          ],
        };
      }
      case 'playSfx': {
        const player = await this.getPlayer(themeId, cmd.playerId, opts);
        const sfx = await this.getAsset(themeId, cmd.sfxId, 'sfx');
        const wire = {
          id: randomUUID(),
          type: 'play' as const,
          channel: 'sfx' as const,
          playerId: player.id,
          assetId: sfx.id,
          ...(await this.mediaFields(sfx.name, sfx.data)),
          ...duckField(player.data.sfxDuckPercent),
        };
        return {
          deliveries: [{ deviceId: player.data.speakerDeviceId, wire }],
          awaitAckOf: cmd.waitUntilEnd
            ? { deviceId: player.data.speakerDeviceId, commandId: wire.id }
            : undefined,
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
          frame: video.data.frame,
          params: video.data.params,
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
          select: { id: true, code: true, data: true },
        });
        if (!hint)
          throw new ResolutionError(
            `hint asset ${cmd.hintId} not found in theme`,
          );
        if (hint.code === null)
          throw new ResolutionError(`hint asset ${cmd.hintId} has no code`);
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
        // Tolerant: a malformed hint row should not fail differently than before.
        const hintData = HintDataSchema.safeParse(hint.data);
        return {
          deliveries: [
            {
              deviceId: device.id,
              wire: {
                id: randomUUID(),
                type: 'hintCode',
                code: hint.code,
                css: device.data.hintCodeCss,
                params: hintData.success ? hintData.data.params : {},
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
              params: {},
            },
          })),
        };
      }
      case 'navigate': {
        const device = await this.getDevice(themeId, cmd.deviceId, opts);
        const website = await this.getAsset(themeId, cmd.websiteId, 'website');
        let url = this.websiteUrl(website.id, website.data, opts.urlOverrides);
        const params = new URLSearchParams();
        for (const { key, value } of cmd.query) {
          if (key === '') continue;
          params.append(key, interpolateString(value, scopeOf(opts)));
        }
        const qs = params.toString();
        if (qs !== '') url += (url.includes('?') ? '&' : '?') + qs;
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
        const wire = {
          id: randomUUID(),
          type: 'message' as const,
          messageId: message.id,
          messageName: message.name,
          payload: buildMessagePayload(message.data, cmd.values, scopeOf(opts)),
          ...(cmd.waitUntilEnd ? { awaitHandled: true } : {}),
        };
        return {
          deliveries: [{ deviceId: device.id, wire }],
          // With waitUntilEnd the device defers its ack until the site's
          // message handlers settle, so the sequence waits on the handler.
          ...(cmd.waitUntilEnd
            ? { awaitAckOf: { deviceId: device.id, commandId: wire.id } }
            : {}),
        };
      }
      case 'sendWebsiteRequest': {
        const website = await this.getAsset(themeId, cmd.websiteId, 'website');
        const scope = scopeOf(opts);
        const baseUrl = this.websiteUrl(
          website.id,
          website.data,
          opts.urlOverrides,
        );
        let base: URL;
        let url: URL;
        try {
          base = new URL(baseUrl);
          const path = interpolateString(cmd.path, scope);
          url = path === '' ? base : new URL(path, base);
        } catch {
          throw new ResolutionError(
            `website request path "${cmd.path}" is invalid`,
          );
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new ResolutionError(
            `website request URL must use http or https (got ${url.protocol})`,
          );
        }
        if (url.origin !== base.origin) {
          throw new ResolutionError(
            'website request path must stay on the website origin',
          );
        }
        return {
          deliveries: [],
          websiteRequest: {
            websiteId: website.id,
            websiteName: website.name,
            url: url.toString(),
            method: cmd.method,
            body: interpolateString(cmd.body, scope),
            headers: cmd.headers.map(({ key, value }) => ({
              key: interpolateString(key, scope),
              value: interpolateString(value, scope),
            })),
            waitUntilEnd: cmd.waitUntilEnd,
          },
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
    // Line cues anchor to line ids; a cue whose line is gone (asset edited
    // since authoring) or last (no gap follows) is dropped — the engine logs.
    const cuesByLine = new Map<number, DialogueCueEntry[]>();
    let droppedCues = 0;
    for (const cue of cmd.lineCues) {
      if (cue.sequence.length === 0) continue;
      const lineIndex = dialogue.data.lines.findIndex(
        (line) => line.id === cue.afterLineId,
      );
      if (lineIndex === -1 || lineIndex === dialogue.data.lines.length - 1) {
        droppedCues++;
        continue;
      }
      const holdIndex = lineIndex + 1;
      cuesByLine.set(holdIndex, [
        ...(cuesByLine.get(holdIndex) ?? []),
        ...cue.sequence,
      ]);
    }
    const lines: WireDialogueLine[] = await Promise.all(
      dialogue.data.lines.map(async (line, index) => ({
        lineId: line.id,
        ...(line.fileKey === null
          ? { fileKey: null, url: null, durationMs: line.durationMs }
          : {
              fileKey: line.fileKey,
              url: await this.mediaUrl(line.fileKey),
              durationMs: null,
            }),
        subtitleHtml: line.subtitleHtml,
        holdBefore: cuesByLine.has(index),
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
      params: dialogue.data.params,
      ...duckField(player.data.dialogueDuckPercent),
    };
    const { speakerDeviceId, screenDeviceId } = player.data;

    const dialogueCues = (deviceId: string, commandId: string) =>
      cuesByLine.size > 0 || droppedCues > 0
        ? { deviceId, commandId, byLine: cuesByLine, dropped: droppedCues }
        : undefined;

    if (speakerDeviceId === screenDeviceId) {
      const wire = { ...base, id: randomUUID(), role: 'both' as const };
      return {
        deliveries: [{ deviceId: speakerDeviceId, wire }],
        awaitAckOf: cmd.waitUntilEnd
          ? { deviceId: speakerDeviceId, commandId: wire.id }
          : undefined,
        dialogueCues: dialogueCues(speakerDeviceId, wire.id),
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
      dialogueCues: dialogueCues(speakerDeviceId, speakerWire.id),
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

  private websiteUrl(
    websiteId: string,
    data: WebsiteData,
    urlOverrides?: Record<string, string>,
  ): string {
    const override = urlOverrides?.[websiteId];
    if (override !== undefined) return override;
    return data.mode === 'hosted'
      ? `${this.publicServerUrl}/api/sites/${websiteId}/`
      : data.url;
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

function scopeOf(opts: ResolveOptions): TemplateScope {
  return { vars: opts.vars, payload: opts.payload };
}

/** Wire duck factor from a player asset's duck percent; null = field absent. */
function duckField(percent: number | null): { bgmDuck?: number } {
  return percent === null ? {} : { bgmDuck: percent / 100 };
}

function buildMessagePayload(
  message: MessageData,
  values: Record<string, JsonValue>,
  scope: TemplateScope,
): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {};
  for (const field of message.fields) {
    // Interpolated before the type check, so an exact "{{vars.x}}" template
    // can satisfy number/boolean/json fields with the variable's own type.
    const value =
      values[field.key] === undefined
        ? undefined
        : interpolate(values[field.key], scope);
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
