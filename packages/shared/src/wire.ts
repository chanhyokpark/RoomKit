import { z } from 'zod';
import { JsonValueSchema } from './json.js';

/**
 * Wire-level commands delivered to devices over the /device namespace.
 *
 * The 17 authoring commands (commands.ts) are resolved server-side into these
 * coarse wire commands: asset ids become presigned URLs, player targets are
 * split into per-device deliveries, and `waitUntilEnd` stays server-side (the
 * runtime decides whether the sequence awaits the ack; devices always ack).
 *
 * Ack contract: apply-type commands (stop/navigate/reset/message) are acked
 * immediately on apply; play commands are acked when playback finishes.
 * Looping BGM acks on playback start.
 *
 * `id` is the delivery id — redeliveries reuse it, clients dedupe on it.
 */

export const PlayChannelSchema = z.enum(['bgm', 'sfx', 'dialogue', 'video']);
export type PlayChannel = z.infer<typeof PlayChannelSchema>;

const wireBase = { id: z.uuid() };

export const WirePlayBgmSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('bgm'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  fileKey: z.string(),
  url: z.url(),
  loop: z.boolean(),
});
export type WirePlayBgm = z.infer<typeof WirePlayBgmSchema>;

export const WirePlaySfxSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('sfx'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  fileKey: z.string(),
  url: z.url(),
});
export type WirePlaySfx = z.infer<typeof WirePlaySfxSchema>;

export const WireDialogueLineSchema = z.object({
  lineId: z.uuid(),
  fileKey: z.string(),
  url: z.url(),
  subtitleHtml: z.string(),
});
export type WireDialogueLine = z.infer<typeof WireDialogueLineSchema>;

/**
 * Dialogue playback. `role` is which half of the player this device is
 * ('both' when speaker === screen). The speaker plays audio and emits
 * `progress` per line; the server relays it to the screen, which renders
 * `lines[lineIndex].subtitleHtml`. The speaker's final ack ends playback.
 */
export const WirePlayDialogueSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('dialogue'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  role: z.enum(['speaker', 'screen', 'both']),
  lines: z.array(WireDialogueLineSchema),
  subtitleCss: z.string(),
  keepSubtitleAfterEnd: z.boolean(),
});
export type WirePlayDialogue = z.infer<typeof WirePlayDialogueSchema>;

export const WirePlayVideoSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('video'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  fileKey: z.string(),
  url: z.url(),
});
export type WirePlayVideo = z.infer<typeof WirePlayVideoSchema>;

export const WirePlayCommandSchema = z.discriminatedUnion('channel', [
  WirePlayBgmSchema,
  WirePlaySfxSchema,
  WirePlayDialogueSchema,
  WirePlayVideoSchema,
]);
export type WirePlayCommand = z.infer<typeof WirePlayCommandSchema>;

/** Stopping dialogue also clears any visible subtitle. */
export const WireStopSchema = z.object({
  ...wireBase,
  type: z.literal('stop'),
  channel: PlayChannelSchema,
  playerId: z.uuid(),
});
export type WireStop = z.infer<typeof WireStopSchema>;

export const WireNavigateSchema = z.object({
  ...wireBase,
  type: z.literal('navigate'),
  websiteId: z.uuid(),
  url: z.url(),
});
export type WireNavigate = z.infer<typeof WireNavigateSchema>;

export const WireResetSchema = z.object({
  ...wireBase,
  type: z.literal('reset'),
});
export type WireReset = z.infer<typeof WireResetSchema>;

export const WireMessageSchema = z.object({
  ...wireBase,
  type: z.literal('message'),
  messageId: z.uuid(),
  messageName: z.string(),
  payload: z.record(z.string(), JsonValueSchema),
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

export const WireCommandSchema = z.union([
  WirePlayCommandSchema,
  WireStopSchema,
  WireNavigateSchema,
  WireResetSchema,
  WireMessageSchema,
]);
export type WireCommand = z.infer<typeof WireCommandSchema>;

/** C→S from the speaker as each dialogue line starts; relayed S→C to the screen. */
export const PlaybackProgressSchema = z.object({
  commandId: z.uuid(),
  lineIndex: z.number().int().nonnegative(),
});
export type PlaybackProgress = z.infer<typeof PlaybackProgressSchema>;
